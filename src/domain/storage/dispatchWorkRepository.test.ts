import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it } from 'vitest'
import { dispatchDisplayState } from '../dispatchRules'
import { deleteReservationDatabase } from './idb'
import { ReservationRepository, type CompleteDispatchCommand, type DispatchWorkCommand } from './repository'

const names: string[] = []
const now = new Date('2026-09-27T01:00:00.000Z')

afterEach(async () => {
  for (const name of names.splice(0)) await deleteReservationDatabase(name)
})

async function setup() {
  const name = `dispatch-work-${crypto.randomUUID()}`
  names.push(name)
  let sequence = 0
  const repository = new ReservationRepository({ databaseName: name, now: () => now, today: () => '2026-09-27', createId: () => `dispatch-work-id-${++sequence}` })
  const { metadata } = await repository.ensureInitialized()
  const snapshot = await repository.snapshot()
  const work = (number: number, key: string): DispatchWorkCommand => {
    const reservation = snapshot.reservations.find((item) => item.reservationId === `demo-reservation-${String(number).padStart(3, '0')}`)!
    const assignment = snapshot.dispatchAssignments.find((item) => item.reservationId === reservation.reservationId)!
    return {
      generationId: metadata.generationId, idempotencyKey: key, actor: 'demo-admin',
      reservationId: reservation.reservationId, expectedReservationVersion: reservation.version,
      dispatchId: assignment.dispatchId, expectedDispatchVersion: assignment.version,
    }
  }
  const complete = (number: number, key: string, outcome: CompleteDispatchCommand['outcome']): CompleteDispatchCommand => ({ ...work(number, key), outcome })
  return { repository, metadata, work, complete }
}

describe('回収開始・作業結果の保存', () => {
  it('開始記録は任意で、記録した場合だけ開始日時と履歴を残す', async () => {
    const { repository, work } = await setup()
    const command = { ...work(11, 'start-11'), actor: 'demo-driver:demo-driver-001' as const }
    const first = await repository.startDispatch(command)
    const replay = await repository.startDispatch(command)
    const snapshot = await repository.snapshot()
    const assignment = snapshot.dispatchAssignments.find((item) => item.dispatchId === command.dispatchId)!
    expect(first.kind).toBe('success')
    expect(replay).toEqual({ kind: 'duplicateSuccess', payload: first.kind === 'success' ? first.payload : undefined })
    expect(assignment).toMatchObject({ status: 'inProgress', startedAt: now.toISOString(), startedBy: command.actor, version: 2 })
    expect(snapshot.auditLogs.filter((item) => item.entityId === command.dispatchId && item.action === 'dispatchStarted')).toHaveLength(1)
    expect((await repository.startDispatch({ ...command, idempotencyKey: 'start-again', expectedDispatchVersion: 2 })).kind).toBe('invalidDispatchTransition')
    repository.close()
  })

  it('開始記録なしの全量回収は予約・配車を一括完了し、再送では履歴を増やさない', async () => {
    const { repository, complete } = await setup()
    const command = { ...complete(11, 'all-11', 'allCollected'), actor: 'demo-driver:demo-driver-001' as const }
    const first = await repository.completeDispatch(command)
    const replay = await repository.completeDispatch(command)
    const snapshot = await repository.snapshot()
    const reservation = snapshot.reservations.find((item) => item.reservationId === command.reservationId)!
    const assignment = snapshot.dispatchAssignments.find((item) => item.dispatchId === command.dispatchId)!
    expect(first.kind).toBe('success')
    expect(replay.kind).toBe('duplicateSuccess')
    expect(reservation).toMatchObject({ status: 'completed', completedAt: now.toISOString(), completedBy: command.actor, version: 2 })
    expect(assignment).toMatchObject({ status: 'completed', outcome: 'allCollected', completedAt: now.toISOString(), completedBy: command.actor, version: 2 })
    expect(assignment.startedAt).toBeUndefined()
    expect(assignment.startedBy).toBeUndefined()
    expect(snapshot.auditLogs.filter((item) => item.entityId === command.dispatchId && item.action === 'dispatchCompleted')).toHaveLength(1)
    expect(snapshot.auditLogs.filter((item) => item.entityId === command.reservationId && item.action === 'completed')).toHaveLength(1)
    expect((await repository.completeDispatch({ ...command, idempotencyKey: 'all-11-again', expectedDispatchVersion: 2, expectedReservationVersion: 2 })).kind).toBe('reservationNotDispatchable')
    repository.close()
  })

  it('回収中から回収不可を登録すると予約は確定のままで、開始記録を保持する', async () => {
    const { repository, complete } = await setup()
    const before = (await repository.snapshot()).dispatchAssignments.find((item) => item.dispatchId === 'demo-dispatch-012')!
    const command = { ...complete(12, 'not-12', 'notCollected'), outcomeNotes: '現場で回収不可品を確認' }
    const result = await repository.completeDispatch(command)
    const snapshot = await repository.snapshot()
    const reservation = snapshot.reservations.find((item) => item.reservationId === command.reservationId)!
    const assignment = snapshot.dispatchAssignments.find((item) => item.dispatchId === command.dispatchId)!
    expect(result.kind).toBe('success')
    expect(reservation.status).toBe('confirmed')
    expect(reservation.version).toBe(1)
    expect(assignment).toMatchObject({ status: 'completed', outcome: 'notCollected', outcomeNotes: command.outcomeNotes, startedAt: before.startedAt, startedBy: before.startedBy })
    expect(dispatchDisplayState(reservation, [assignment]).state).toBe('needsAttention')
    repository.close()
  })

  it('開始記録なしの一部回収は今回の配車だけを終了し、要再配車へ進む', async () => {
    const { repository, complete } = await setup()
    const command = { ...complete(11, 'partial-11', 'partiallyCollected'), actualCollectionSummary: '空き缶 1袋', outcomeNotes: '残りは別日調整' }
    const result = await repository.completeDispatch(command)
    const snapshot = await repository.snapshot()
    const reservation = snapshot.reservations.find((item) => item.reservationId === command.reservationId)!
    const assignment = snapshot.dispatchAssignments.find((item) => item.dispatchId === command.dispatchId)!
    expect(result.kind).toBe('success')
    expect(reservation.status).toBe('confirmed')
    expect(assignment.startedAt).toBeUndefined()
    expect(dispatchDisplayState(reservation, [assignment]).state).toBe('needsRedispatch')
    repository.close()
  })

  it('必須メモ、古い版、終了済み配車を拒否し、データを変えない', async () => {
    const { repository, work, complete } = await setup()
    expect((await repository.completeDispatch(complete(11, 'partial-empty', 'partiallyCollected'))).kind).toBe('validationError')
    expect((await repository.completeDispatch(complete(11, 'not-empty', 'notCollected'))).kind).toBe('validationError')
    expect((await repository.completeDispatch({ ...complete(11, 'no-outcome', 'allCollected'), outcome: undefined as unknown as CompleteDispatchCommand['outcome'] })).kind).toBe('invalidOutcome')
    expect((await repository.startDispatch({ ...work(11, 'stale-start'), expectedDispatchVersion: 0 })).kind).toBe('dispatchVersionConflict')
    expect((await repository.completeDispatch(complete(13, 'completed-again', 'allCollected'))).kind).toBe('reservationNotDispatchable')
    expect((await repository.snapshot()).dispatchAssignments.find((item) => item.dispatchId === 'demo-dispatch-011')?.status).toBe('assigned')
    repository.close()
  })

  it('要再確認の配車でも回収開始でき、変更確認の表示状態を保持する', async () => {
    const { repository, work } = await setup()
    const result = await repository.startDispatch(work(16, 'review-start'))
    expect(result.kind).toBe('success')
    const assignment = (await repository.snapshot()).dispatchAssignments.find((item) => item.dispatchId === 'demo-dispatch-016')!
    expect(assignment).toMatchObject({ status: 'inProgress', needsReview: true, version: 2 })
    repository.close()
  })

  it('要再確認の配車でも開始記録なしで作業結果を登録できる', async () => {
    const { repository, complete } = await setup()
    const result = await repository.completeDispatch(complete(16, 'review-complete', 'allCollected'))
    expect(result.kind).toBe('success')
    const snapshot = await repository.snapshot()
    expect(snapshot.reservations.find((item) => item.reservationId === 'demo-reservation-016')?.status).toBe('completed')
    expect(snapshot.dispatchAssignments.find((item) => item.dispatchId === 'demo-dispatch-016')).toMatchObject({ status: 'completed', needsReview: true })
    repository.close()
  })

  it('全量回収と搬入判断待ちを一括保存し、保留車両で他案件を開始できない', async () => {
    const { repository, work, complete } = await setup()
    const unassigned = (await repository.snapshot()).reservations.find((item) => item.reservationId === 'demo-reservation-010')!
    const future = await repository.createDispatch({
      generationId: work(11, 'unused').generationId, idempotencyKey: 'future-before-hold', actor: 'demo-admin',
      reservationId: unassigned.reservationId, expectedReservationVersion: unassigned.version,
      plannedDate: unassigned.requestedDate, plannedStartTime: '09:00', plannedEndTime: '10:00',
      vehicleId: 'demo-vehicle-001', primaryDriverId: 'demo-driver-001',
    })
    expect(future.kind).toBe('success')
    const command = { ...complete(11, 'all-with-hold', 'allCollected'), holdRequest: { expectedVehicleVersion: 1, reason: '搬入先が受入を停止', consultationNote: '電話確認待ち' } }
    const result = await repository.completeDispatch(command)
    const snapshot = await repository.snapshot()
    const vehicle = snapshot.vehicles.find((item) => item.vehicleId === 'demo-vehicle-001')!
    expect(result.kind).toBe('success')
    expect(vehicle).toMatchObject({ version: 2, loadHold: { status: 'decisionPending', reservationId: command.reservationId, dispatchId: command.dispatchId, startedBy: 'demo-admin' } })
    expect(snapshot.auditLogs.some((item) => item.entityId === vehicle.vehicleId && item.action === 'loadHoldStarted')).toBe(true)
    if (future.kind !== 'success') throw new Error('配車登録に失敗しました。')
    const futureCommand = { generationId: work(11, 'unused').generationId, actor: 'demo-admin' as const, reservationId: unassigned.reservationId, expectedReservationVersion: unassigned.version, dispatchId: future.payload.dispatchId!, expectedDispatchVersion: future.payload.dispatchVersion! }
    expect((await repository.startDispatch({ ...futureCommand, idempotencyKey: 'held-start' })).kind).toBe('vehicleOnHold')
    expect((await repository.completeDispatch({ ...futureCommand, idempotencyKey: 'held-complete', outcome: 'allCollected' })).kind).toBe('vehicleOnHold')
    repository.close()
  })

  it('ドライバーの同時保留申告と回収不可からの保留を拒否する', async () => {
    const { repository, complete } = await setup()
    const holdRequest = { expectedVehicleVersion: 1, reason: '搬入先確認中' }
    expect((await repository.completeDispatch({ ...complete(11, 'driver-hold', 'allCollected'), actor: 'demo-driver:demo-driver-001', holdRequest })).kind).toBe('invalidOutcome')
    expect((await repository.completeDispatch({ ...complete(11, 'no-collection-hold', 'notCollected'), outcomeNotes: '回収不可', holdRequest })).kind).toBe('invalidOutcome')
    expect((await repository.snapshot()).vehicles.find((item) => item.vehicleId === 'demo-vehicle-001')?.loadHold).toBeUndefined()
    repository.close()
  })

  it('開始後の重要変更で要再確認でも、回収中の作業結果は保存できる', async () => {
    const { repository, metadata, work } = await setup()
    const reservation = (await repository.snapshot()).reservations.find((item) => item.reservationId === 'demo-reservation-012')!
    const changed = await repository.updateReservation({
      generationId: metadata.generationId, idempotencyKey: 'change-during-work', actor: 'demo-admin',
      reservationId: reservation.reservationId, expectedVersion: reservation.version,
      input: {
        categoryId: reservation.categoryId, requestedDate: reservation.requestedDate,
        companyName: reservation.companyName, contactName: reservation.contactName,
        phone: reservation.phoneDisplay, address: reservation.address,
        contactNotes: '現場入口で電話確認', categoryAnswers: reservation.categoryAnswers,
      },
    })
    expect(changed.kind).toBe('success')
    const before = (await repository.snapshot()).dispatchAssignments.find((item) => item.dispatchId === 'demo-dispatch-012')!
    expect(before).toMatchObject({ status: 'inProgress', needsReview: true, version: 3 })
    const result = await repository.completeDispatch({ ...work(12, 'complete-after-change'), expectedReservationVersion: 2, expectedDispatchVersion: 3, outcome: 'allCollected' })
    expect(result.kind).toBe('success')
    const after = await repository.snapshot()
    expect(after.reservations.find((item) => item.reservationId === reservation.reservationId)?.status).toBe('completed')
    expect(after.dispatchAssignments.find((item) => item.dispatchId === 'demo-dispatch-012')).toMatchObject({ status: 'completed', startedAt: before.startedAt })
    repository.close()
  })

  it('一部回収と同時の搬入判断待ちは、予約を確定のまま車両だけ保留する', async () => {
    const { repository, complete } = await setup()
    const command = {
      ...complete(11, 'partial-with-hold', 'partiallyCollected'),
      actualCollectionSummary: '空き缶 1袋', outcomeNotes: '残りは別日調整',
      holdRequest: { expectedVehicleVersion: 1, reason: '搬入先の状況を確認中' },
    }
    const result = await repository.completeDispatch(command)
    expect(result.kind).toBe('success')
    const snapshot = await repository.snapshot()
    expect(snapshot.reservations.find((item) => item.reservationId === command.reservationId)?.status).toBe('confirmed')
    expect(snapshot.dispatchAssignments.find((item) => item.dispatchId === command.dispatchId)?.outcome).toBe('partiallyCollected')
    expect(snapshot.vehicles.find((item) => item.vehicleId === 'demo-vehicle-001')?.loadHold?.status).toBe('decisionPending')
    repository.close()
  })
})
