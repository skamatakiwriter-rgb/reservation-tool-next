import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it } from 'vitest'
import type { CategoryId, ReservationInput } from '../types'
import { addCalendarDays, isSunday } from '../dateRules'
import { deleteReservationDatabase } from './idb'
import { classifyStorageError, ReservationRepository } from './repository'

const databaseNames: string[] = []
const today = '2026-09-16'
const baseTime = new Date('2026-09-16T01:00:00.000Z')

afterEach(async () => {
  for (const name of databaseNames.splice(0)) await deleteReservationDatabase(name)
})

describe('ReservationRepository', () => {
  it('保存容量不足とその他のDB障害を画面で区別できる結果へ変換する', () => {
    expect(classifyStorageError(new DOMException('full', 'QuotaExceededError')).kind).toBe('storageFull')
    expect(classifyStorageError(new Error('unavailable')).kind).toBe('storageUnavailable')
  })

  it('設計どおりの初期データ9件、上限、停止日、再受付履歴を作る', async () => {
    const repository = makeRepository()
    const initialized = await repository.ensureInitialized()
    const snapshot = await repository.snapshot()

    expect(initialized.kind).toBe('initialized')
    expect(snapshot.reservations).toHaveLength(9)
    expect(snapshot.settings).toHaveLength(3)
    expect(snapshot.settings.every((setting) => setting.dailyLimit === 2)).toBe(true)
    expect(snapshot.closures).toHaveLength(1)
    expect(snapshot.closures[0]).toMatchObject({ categoryId: 'kagu', isClosed: true })
    expect(snapshot.reservations.find((item) => item.reservationCode === 'DEMO-001')?.status).toBe('completed')
    expect(snapshot.reservations.find((item) => item.reservationCode === 'DEMO-002')?.status).toBe('cancelled')
    expect(snapshot.reservations.find((item) => item.reservationCode === 'DEMO-008')?.overrideType).toBe('fullCapacity')
    expect(snapshot.reservations.find((item) => item.reservationCode === 'DEMO-009')).toMatchObject({
      requestedDate: today,
      status: 'confirmed',
      sourceReservationId: 'demo-reservation-002',
    })
    expect(snapshot.reservations.filter((item) => item.workGroupCode === 'GROUP-DEMO-006')).toHaveLength(3)
    expect(snapshot.auditLogs.some((log) => log.entityId === 'demo-reservation-001' && log.action === 'confirmed')).toBe(true)
    expect(snapshot.auditLogs.some((log) => log.entityId === 'demo-reservation-001' && log.action === 'completed')).toBe(true)
    expect(snapshot.auditLogs).toContainEqual(expect.objectContaining({ entityId: 'demo-reservation-009', action: 'reaccepted', relatedReservationId: 'demo-reservation-002' }))
    expect(snapshot.auditLogs).toContainEqual(expect.objectContaining({ entityId: 'demo-reservation-002', action: 'reacceptedAs', relatedReservationId: 'demo-reservation-009' }))
    const sourceHistory = snapshot.auditLogs
      .filter((log) => log.entityId === 'demo-reservation-002')
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    expect(sourceHistory.map((log) => log.action)).toEqual(['created', 'cancelled', 'reacceptedAs'])
    expect(new Set(sourceHistory.map((log) => log.occurredAt))).toHaveProperty('size', 3)
    repository.close()
  })

  it('7日以内はデータを維持し、7日を超えると新しい世代で初期化する', async () => {
    let now = new Date(baseTime)
    const repository = makeRepository({ now: () => now })
    const first = await repository.ensureInitialized()
    const retained = await repository.ensureInitialized()
    expect(retained.kind).toBe('retained')
    expect(retained.metadata.generationId).toBe(first.metadata.generationId)

    now = new Date(baseTime.getTime() + 7 * 24 * 60 * 60 * 1000 + 1)
    const expired = await repository.ensureInitialized()
    expect(expired.kind).toBe('initialized')
    expect(expired.metadata.generationId).not.toBe(first.metadata.generationId)
    expect((await repository.snapshot()).reservations).toHaveLength(9)
    repository.close()
  })

  it('リセット後は古い画面の保存を拒否する', async () => {
    const repository = makeRepository()
    const first = await repository.ensureInitialized()
    const reset = await repository.resetDemoData(first.metadata.generationId)
    expect(reset.kind).toBe('success')

    const stale = await repository.createReservation(createCommand(first.metadata.generationId, 'stale-after-reset'))
    expect(stale.kind).toBe('staleGeneration')
    repository.close()
  })

  it('削除時は業務データを消し、古い画面を拒否し、次回起動時に再作成する', async () => {
    const repository = makeRepository()
    const first = await repository.ensureInitialized()
    const deleted = await repository.deleteDemoData(first.metadata.generationId)
    expect(deleted.kind).toBe('success')
    const empty = await repository.snapshot()
    expect(empty.metadata?.lifecycleState).toBe('deleted')
    expect(empty.reservations).toHaveLength(0)
    expect(empty.settings).toHaveLength(0)

    const stale = await repository.createReservation(createCommand(first.metadata.generationId, 'stale-after-delete'))
    expect(stale.kind).toBe('staleGeneration')
    const restarted = await repository.ensureInitialized()
    expect(restarted.kind).toBe('initialized')
    expect((await repository.snapshot()).reservations).toHaveLength(9)
    repository.close()
  })

  it('同じ送信キーと同じ内容は同一結果を返し、内容が違えば競合にする', async () => {
    const repository = makeRepository()
    const initialized = await repository.ensureInitialized()
    const command = createCommand(initialized.metadata.generationId, 'same-key')
    const first = await repository.createReservation(command)
    const replay = await repository.createReservation(command)
    const conflict = await repository.createReservation({
      ...command,
      input: { ...command.input, companyName: '別の架空会社' },
    })

    expect(first.kind).toBe('success')
    expect(replay).toEqual({ kind: 'duplicateSuccess', payload: first.kind === 'success' ? first.payload : undefined })
    expect(conflict.kind).toBe('idempotencyConflict')
    expect((await repository.snapshot()).reservations).toHaveLength(10)
    const operation = await repository.findOperationResult(initialized.metadata.generationId, 'same-key')
    expect(operation?.resultPayload.reservationId).toBe(first.kind === 'success' ? first.payload.reservationId : '')
    repository.close()
  })

  it('再読み込み相当でDBを開き直しても処理結果を照会し、再送を重複登録しない', async () => {
    const name = `reservation-reload-${crypto.randomUUID()}`
    databaseNames.push(name)
    let counter = 0
    const options = {
      databaseName: name,
      now: () => new Date(baseTime),
      today: () => today,
      createId: () => `reload-${String(++counter).padStart(4, '0')}`,
    }
    const firstRepository = new ReservationRepository(options)
    const initialized = await firstRepository.ensureInitialized()
    const command = createCommand(initialized.metadata.generationId, 'reload-key')
    const first = await firstRepository.createReservation(command)
    firstRepository.close()

    const reopenedRepository = new ReservationRepository(options)
    const retained = await reopenedRepository.ensureInitialized()
    const operation = await reopenedRepository.findOperationResult(initialized.metadata.generationId, 'reload-key')
    const replay = await reopenedRepository.createReservation(command)

    expect(retained.kind).toBe('retained')
    expect(operation?.resultPayload).toEqual(first.kind === 'success' ? first.payload : undefined)
    expect(replay.kind).toBe('duplicateSuccess')
    expect((await reopenedRepository.snapshot()).reservations).toHaveLength(10)
    reopenedRepository.close()
  })

  it('最後の1枠への同時保存は1件だけ成功させる', async () => {
    const repository = makeRepository()
    const initialized = await repository.ensureInitialized()
    const date = nextOpenDate(today, 3)
    const first = await repository.createReservation(createCommand(initialized.metadata.generationId, 'fill-one', 'keikoukan', date))
    expect(first.kind).toBe('success')

    const results = await Promise.all([
      repository.createReservation(createCommand(initialized.metadata.generationId, 'race-a', 'keikoukan', date)),
      repository.createReservation(createCommand(initialized.metadata.generationId, 'race-b', 'keikoukan', date)),
    ])
    expect(results.filter((result) => result.kind === 'success')).toHaveLength(1)
    expect(results.filter((result) => result.kind === 'capacityFull')).toHaveLength(1)
    repository.close()
  })

  it('管理者が明示した場合だけ満枠へ例外登録する', async () => {
    const repository = makeRepository()
    const initialized = await repository.ensureInitialized()
    const snapshot = await repository.snapshot()
    const fullDate = snapshot.reservations.find((item) => item.reservationCode === 'DEMO-003')!.requestedDate

    const denied = await repository.createReservation(createCommand(initialized.metadata.generationId, 'full-denied', 'binkan', fullDate, 'admin'))
    const allowed = await repository.createReservation({
      ...createCommand(initialized.metadata.generationId, 'full-allowed', 'binkan', fullDate, 'admin'),
      allowFullCapacityOverride: true,
      detailsConfirmed: true,
    })
    expect(denied.kind).toBe('capacityFull')
    expect(allowed.kind).toBe('success')
    const created = (await repository.snapshot()).reservations.find((item) => item.reservationId === (allowed.kind === 'success' ? allowed.payload.reservationId : ''))
    expect(created).toMatchObject({ status: 'confirmed', overrideType: 'fullCapacity' })
    repository.close()
  })

  it('取消予約からの再受付は元予約を取消のまま保ち、新旧双方へ相互履歴を残す', async () => {
    const repository = makeRepository()
    const initialized = await repository.ensureInitialized()
    const source = (await repository.snapshot()).reservations.find((item) => item.reservationCode === 'DEMO-002')!
    const created = await repository.createReservation({
      ...createCommand(initialized.metadata.generationId, 'reaccept-cancelled', 'kagu', nextOpenDate(today, 3), 'admin'),
      sourceReservationId: source.reservationId,
    })

    expect(created.kind).toBe('success')
    const snapshot = await repository.snapshot()
    const createdId = created.kind === 'success' ? created.payload.reservationId : undefined
    const savedSource = snapshot.reservations.find((item) => item.reservationId === source.reservationId)
    const savedCreated = snapshot.reservations.find((item) => item.reservationId === createdId)
    expect(savedSource?.status).toBe('cancelled')
    expect(savedCreated).toMatchObject({ sourceReservationId: source.reservationId, status: 'received' })
    expect(snapshot.auditLogs).toContainEqual(expect.objectContaining({
      entityId: savedCreated?.reservationId,
      action: 'reaccepted',
      relatedReservationId: source.reservationId,
    }))
    expect(snapshot.auditLogs).toContainEqual(expect.objectContaining({
      entityId: source.reservationId,
      action: 'reacceptedAs',
      relatedReservationId: savedCreated?.reservationId,
    }))
    repository.close()
  })

  it('取消ではない予約の依頼者情報再利用は再受付履歴にしない', async () => {
    const repository = makeRepository()
    const initialized = await repository.ensureInitialized()
    const source = (await repository.snapshot()).reservations.find((item) => item.reservationCode === 'DEMO-003')!
    const created = await repository.createReservation({
      ...createCommand(initialized.metadata.generationId, 'reuse-active', 'binkan', nextOpenDate(today, 3), 'admin'),
      sourceReservationId: source.reservationId,
    })

    expect(created.kind).toBe('success')
    const snapshot = await repository.snapshot()
    const createdId = created.kind === 'success' ? created.payload.reservationId : undefined
    expect(snapshot.auditLogs).toContainEqual(expect.objectContaining({ entityId: createdId, action: 'created' }))
    expect(snapshot.auditLogs.some((log) => log.entityId === source.reservationId && log.action === 'reacceptedAs')).toBe(false)
    repository.close()
  })

  it('状態更新は版競合と不正遷移を防ぎ、再送時は同じ結果を返す', async () => {
    const repository = makeRepository()
    const initialized = await repository.ensureInitialized()
    const target = (await repository.snapshot()).reservations.find((item) => item.reservationCode === 'DEMO-003')!

    const changed = await repository.changeStatus({
      generationId: initialized.metadata.generationId,
      idempotencyKey: 'confirm-003',
      actor: 'demo-admin',
      reservationId: target.reservationId,
      expectedVersion: 1,
      nextStatus: 'confirmed',
    })
    const replay = await repository.changeStatus({
      generationId: initialized.metadata.generationId,
      idempotencyKey: 'confirm-003',
      actor: 'demo-admin',
      reservationId: target.reservationId,
      expectedVersion: 1,
      nextStatus: 'confirmed',
    })
    const versionConflict = await repository.changeStatus({
      generationId: initialized.metadata.generationId,
      idempotencyKey: 'old-version',
      actor: 'demo-admin',
      reservationId: target.reservationId,
      expectedVersion: 1,
      nextStatus: 'completed',
    })
    const invalidTransition = await repository.changeStatus({
      generationId: initialized.metadata.generationId,
      idempotencyKey: 'backward-status',
      actor: 'demo-admin',
      reservationId: target.reservationId,
      expectedVersion: 2,
      nextStatus: 'received',
    })

    expect(changed.kind).toBe('success')
    expect(replay.kind).toBe('duplicateSuccess')
    expect(versionConflict.kind).toBe('versionConflict')
    expect(invalidTransition.kind).toBe('invalidTransition')
    expect((await repository.snapshot()).auditLogs.some((log) => log.entityId === target.reservationId && log.action === 'confirmed')).toBe(true)
    repository.close()
  })

  it('管理者の予約変更は同じ予約IDを保ち、変更履歴と版を更新する', async () => {
    const repository = makeRepository()
    const initialized = await repository.ensureInitialized()
    const target = (await repository.snapshot()).reservations.find((item) => item.reservationCode === 'DEMO-003')!
    const input = validInput('binkan', target.requestedDate, 'admin')
    input.companyName = '変更後の架空会社'
    const changed = await repository.updateReservation({ generationId: initialized.metadata.generationId, idempotencyKey: 'update-003', actor: 'demo-admin', reservationId: target.reservationId, expectedVersion: target.version, input })

    expect(changed.kind).toBe('success')
    const saved = (await repository.snapshot()).reservations.find((item) => item.reservationId === target.reservationId)
    expect(saved).toMatchObject({ companyName: '変更後の架空会社', version: 2, status: 'received' })
    expect((await repository.snapshot()).auditLogs.some((log) => log.entityId === target.reservationId && log.action === 'updated')).toBe(true)
    repository.close()
  })

  it('カテゴリー上限を更新し、古い版からの再更新を拒否する', async () => {
    const repository = makeRepository()
    const initialized = await repository.ensureInitialized()
    const first = await repository.updateCategoryLimit({ generationId: initialized.metadata.generationId, idempotencyKey: 'limit-1', actor: 'demo-admin', categoryId: 'kagu', expectedVersion: 1, dailyLimit: 3 })
    const stale = await repository.updateCategoryLimit({ generationId: initialized.metadata.generationId, idempotencyKey: 'limit-stale', actor: 'demo-admin', categoryId: 'kagu', expectedVersion: 1, dailyLimit: 4 })

    expect(first.kind).toBe('success')
    expect(stale.kind).toBe('versionConflict')
    expect((await repository.snapshot()).settings.find((item) => item.categoryId === 'kagu')).toMatchObject({ dailyLimit: 3, version: 2 })
    repository.close()
  })

  it('選択日・カテゴリーの受付停止と解除を履歴付きで保存する', async () => {
    const repository = makeRepository()
    const initialized = await repository.ensureInitialized()
    const date = nextOpenDate(today, 6)
    const closed = await repository.setClosure({ generationId: initialized.metadata.generationId, idempotencyKey: 'close-date', actor: 'demo-admin', date, categoryId: 'keikoukan', isClosed: true })
    const current = (await repository.snapshot()).closures.find((item) => item.date === date && item.categoryId === 'keikoukan')!
    const reopened = await repository.setClosure({ generationId: initialized.metadata.generationId, idempotencyKey: 'open-date', actor: 'demo-admin', date, categoryId: 'keikoukan', expectedVersion: current.version, isClosed: false })

    expect(closed.kind).toBe('success')
    expect(reopened.kind).toBe('success')
    expect((await repository.snapshot()).closures.find((item) => item.closureId === current.closureId)).toMatchObject({ isClosed: false, version: 2 })
    repository.close()
  })
})

function makeRepository(overrides: { now?: () => Date } = {}) {
  const name = `reservation-test-${crypto.randomUUID()}`
  databaseNames.push(name)
  let counter = 0
  return new ReservationRepository({
    databaseName: name,
    now: overrides.now ?? (() => new Date(baseTime)),
    today: () => today,
    createId: () => `generated-${String(++counter).padStart(4, '0')}`,
  })
}

function createCommand(
  generationId: string,
  idempotencyKey: string,
  categoryId: CategoryId = 'keikoukan',
  requestedDate = nextOpenDate(today, 3),
  channel: 'public' | 'admin' = 'public',
) {
  return {
    generationId,
    idempotencyKey,
    channel,
    actor: channel === 'admin' ? 'demo-admin' as const : 'demo-user' as const,
    input: validInput(categoryId, requestedDate, channel),
  }
}

function validInput(categoryId: CategoryId, requestedDate: string, channel: 'public' | 'admin'): ReservationInput {
  return {
    categoryId,
    requestedDate,
    companyName: '架空テスト株式会社',
    contactName: '予約 太郎',
    phone: '03-1234-5678',
    address: categoryId === 'keikoukan' ? undefined : '架空県架空市1番地',
    contactNotes: '',
    categoryAnswers: categoryId === 'keikoukan'
      ? { approximateTubeCount: 10 }
      : categoryId === 'kagu'
        ? { itemsAndQuantities: '机 1台' }
        : { typesAndQuantities: '空き缶 1袋' },
    demoNoticeAccepted: channel === 'public',
  }
}

function nextOpenDate(start: string, offset: number): string {
  let date = addCalendarDays(start, offset)
  while (isSunday(date)) date = addCalendarDays(date, 1)
  return date
}
