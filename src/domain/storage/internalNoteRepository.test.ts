import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it } from 'vitest'
import { deleteReservationDatabase } from './idb'
import { ReservationRepository } from './repository'

const names: string[] = []

afterEach(async () => {
  for (const name of names.splice(0)) await deleteReservationDatabase(name)
})

async function setup() {
  const name = `internal-note-${crypto.randomUUID()}`
  names.push(name)
  let sequence = 0
  const repository = new ReservationRepository({ databaseName: name, now: () => new Date('2026-09-27T01:00:00.000Z'), today: () => '2026-09-27', createId: () => `note-test-id-${++sequence}` })
  const { metadata } = await repository.ensureInitialized()
  return { repository, generationId: metadata.generationId }
}

describe('社内補足の追記保存', () => {
  it('本文を整形して追記し、監査履歴には本文を複製しない', async () => {
    const { repository, generationId } = await setup()
    const before = (await repository.snapshot()).internalNotes.length
    const command = { generationId, idempotencyKey: 'note-once', actor: 'demo-admin' as const, reservationId: 'demo-reservation-010', body: '  電話で確認。現地の量は増減する可能性あり。  ' }
    const first = await repository.addInternalNote(command)
    const replay = await repository.addInternalNote(command)
    const conflict = await repository.addInternalNote({ ...command, body: '別の内容' })
    const snapshot = await repository.snapshot()
    const note = snapshot.internalNotes.find((item) => item.noteId === (first.kind === 'success' ? first.payload.noteId : ''))
    const audit = snapshot.auditLogs.find((item) => item.entityId === note?.noteId)

    expect(first.kind).toBe('success')
    expect(replay).toEqual({ kind: 'duplicateSuccess', payload: first.kind === 'success' ? first.payload : undefined })
    expect(conflict.kind).toBe('idempotencyConflict')
    expect(snapshot.internalNotes).toHaveLength(before + 1)
    expect(note).toMatchObject({ reservationId: command.reservationId, body: '電話で確認。現地の量は増減する可能性あり。', createdBy: 'demo-admin' })
    expect(audit).toMatchObject({ entityType: 'internalNote', action: 'internalNoteAdded', after: { reservationId: command.reservationId } })
    expect(JSON.stringify(audit)).not.toContain(note?.body)
    repository.close()
  })

  it('空白・501文字・存在しない予約・ドライバーからの追記を拒否する', async () => {
    const { repository, generationId } = await setup()
    const base = { generationId, actor: 'demo-admin' as const, reservationId: 'demo-reservation-010' }
    expect((await repository.addInternalNote({ ...base, idempotencyKey: 'blank', body: '   ' })).kind).toBe('validationError')
    expect((await repository.addInternalNote({ ...base, idempotencyKey: 'long', body: 'あ'.repeat(501) })).kind).toBe('validationError')
    expect((await repository.addInternalNote({ ...base, idempotencyKey: 'missing', reservationId: 'missing', body: '確認事項' })).kind).toBe('notFound')
    expect((await repository.addInternalNote({ ...base, idempotencyKey: 'driver', actor: 'demo-driver:demo-driver-001', body: '確認事項' })).kind).toBe('invalidTransition')
    expect((await repository.snapshot()).internalNotes).toHaveLength(3)
    repository.close()
  })

  it('利用者用とドライバー用のスナップショットには本文を含めない', async () => {
    const { repository, generationId } = await setup()
    await repository.addInternalNote({ generationId, idempotencyKey: 'private-note', actor: 'demo-admin', reservationId: 'demo-reservation-010', body: '社内だけで扱う内容' })
    expect((await repository.snapshot('public')).internalNotes).toEqual([])
    expect((await repository.snapshot('driver')).internalNotes).toEqual([])
    expect((await repository.snapshot('admin')).internalNotes.some((item) => item.body === '社内だけで扱う内容')).toBe(true)
    repository.close()
  })
})
