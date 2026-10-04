import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it } from 'vitest'
import { dispatchDisplayState } from '../dispatchRules'
import type { Reservation } from '../types'
import { deleteReservationDatabase } from './idb'
import { ReservationRepository, type CreateDispatchCommand } from './repository'

const names: string[] = []
const now = new Date('2026-09-27T01:00:00.000Z')

afterEach(async () => {
  for (const name of names.splice(0)) await deleteReservationDatabase(name)
})

async function setup() {
  const name = `dispatch-repository-${crypto.randomUUID()}`
  names.push(name)
  let sequence = 0
  const repository = new ReservationRepository({ databaseName: name, now: () => now, today: () => '2026-09-27', createId: () => `dispatch-test-${++sequence}` })
  const { metadata } = await repository.ensureInitialized()
  const snapshot = await repository.snapshot()
  const reservation = (number: number): Reservation => snapshot.reservations.find((item) => item.reservationId === `demo-reservation-${String(number).padStart(3, '0')}`)!
  const command = (number: number, key: string): CreateDispatchCommand => ({
    generationId: metadata.generationId,
    idempotencyKey: key,
    actor: 'demo-admin',
    reservationId: reservation(number).reservationId,
    expectedReservationVersion: reservation(number).version,
    plannedDate: reservation(number).requestedDate,
    plannedStartTime: '09:00',
    plannedEndTime: '10:00',
    vehicleId: 'demo-vehicle-001',
    primaryDriverId: 'demo-driver-001',
  })
  return { repository, metadata, reservation, command }
}

describe('配車登録・変更・取消の保存', () => {
  it('確定予約へ初回配車を登録し、同じ送信は再現し異なる内容の再送は拒否する', async () => {
    const { repository, reservation, command } = await setup()
    const input = command(10, 'create-10')
    const first = await repository.createDispatch(input)
    const replay = await repository.createDispatch(input)
    const conflict = await repository.createDispatch({ ...input, plannedEndTime: '11:00' })
    const snapshot = await repository.snapshot()
    const assignment = snapshot.dispatchAssignments.find((item) => item.reservationId === reservation(10).reservationId)

    expect(first.kind).toBe('success')
    expect(replay).toEqual({ kind: 'duplicateSuccess', payload: first.kind === 'success' ? first.payload : undefined })
    expect(conflict.kind).toBe('idempotencyConflict')
    expect(assignment).toMatchObject({ status: 'assigned', attemptNumber: 1, reservationVersionAtAssignment: 1, version: 1 })
    expect(snapshot.auditLogs.filter((item) => item.entityId === assignment?.dispatchId && item.action === 'dispatchCreated')).toHaveLength(1)
    expect(await repository.findOperationResult(input.generationId, input.idempotencyKey)).toMatchObject({ resultPayload: first.kind === 'success' ? first.payload : undefined })
    expect((await repository.createDispatch({ ...input, idempotencyKey: 'second-10' })).kind).toBe('activeDispatchExists')
    repository.close()
  })

  it('担当変更を履歴へ残し、最新状態に対する旧担当者の確認だけを記録する', async () => {
    const { repository, reservation, command } = await setup()
    const created = await repository.createDispatch(command(10, 'create-driver-change-10'))
    expect(created.kind).toBe('success')
    let snapshot = await repository.snapshot()
    let assignment = snapshot.dispatchAssignments.find((item) => item.reservationId === reservation(10).reservationId)!
    const changed = await repository.updateDispatch({
      ...command(10, 'change-driver-10'), dispatchId: assignment.dispatchId, expectedDispatchVersion: assignment.version,
      vehicleId: assignment.vehicleId, primaryDriverId: 'demo-driver-002', driverInstructions: assignment.driverInstructions,
    })
    expect(changed.kind).toBe('success')
    snapshot = await repository.snapshot()
    assignment = snapshot.dispatchAssignments.find((item) => item.dispatchId === assignment.dispatchId)!
    const firstEvent = assignment.driverReassignmentHistory?.[0]
    expect(firstEvent).toMatchObject({ before: { primaryDriverId: 'demo-driver-001' }, after: { primaryDriverId: 'demo-driver-002' } })

    expect((await repository.updateDispatch({ ...command(10, 'return-driver-10'), dispatchId: assignment.dispatchId, expectedDispatchVersion: assignment.version, vehicleId: assignment.vehicleId, primaryDriverId: 'demo-driver-001', driverInstructions: assignment.driverInstructions })).kind).toBe('success')
    snapshot = await repository.snapshot()
    assignment = snapshot.dispatchAssignments.find((item) => item.dispatchId === assignment.dispatchId)!
    expect((await repository.acknowledgeDriverReassignment({ generationId: snapshot.metadata!.generationId, idempotencyKey: 'returned-driver-change-ack', actor: 'demo-driver:demo-driver-001', reservationId: reservation(10).reservationId, expectedReservationVersion: reservation(10).version, dispatchId: assignment.dispatchId, expectedDispatchVersion: assignment.version, changeId: firstEvent!.changeId })).kind).toBe('invalidDispatchTransition')

    expect((await repository.updateDispatch({ ...command(10, 'change-driver-again-10'), dispatchId: assignment.dispatchId, expectedDispatchVersion: assignment.version, vehicleId: assignment.vehicleId, primaryDriverId: 'demo-driver-002', driverInstructions: assignment.driverInstructions })).kind).toBe('success')
    snapshot = await repository.snapshot()
    assignment = snapshot.dispatchAssignments.find((item) => item.dispatchId === assignment.dispatchId)!
    const latestEvent = [...(assignment.driverReassignmentHistory ?? [])].reverse().find((item) => item.before.primaryDriverId === 'demo-driver-001')!
    expect((await repository.acknowledgeDriverReassignment({ generationId: snapshot.metadata!.generationId, idempotencyKey: 'old-driver-change-ack', actor: 'demo-driver:demo-driver-001', reservationId: reservation(10).reservationId, expectedReservationVersion: reservation(10).version, dispatchId: assignment.dispatchId, expectedDispatchVersion: assignment.version, changeId: firstEvent!.changeId })).kind).toBe('invalidDispatchTransition')
    expect((await repository.acknowledgeDriverReassignment({ generationId: snapshot.metadata!.generationId, idempotencyKey: 'wrong-driver-change-ack', actor: 'demo-driver:demo-driver-002', reservationId: reservation(10).reservationId, expectedReservationVersion: reservation(10).version, dispatchId: assignment.dispatchId, expectedDispatchVersion: assignment.version, changeId: latestEvent.changeId })).kind).toBe('invalidDispatchTransition')
    const acknowledged = await repository.acknowledgeDriverReassignment({ generationId: snapshot.metadata!.generationId, idempotencyKey: 'driver-change-ack', actor: 'demo-driver:demo-driver-001', reservationId: reservation(10).reservationId, expectedReservationVersion: reservation(10).version, dispatchId: assignment.dispatchId, expectedDispatchVersion: assignment.version, changeId: latestEvent.changeId })
    expect(acknowledged.kind).toBe('success')
    assignment = (await repository.snapshot()).dispatchAssignments.find((item) => item.dispatchId === assignment.dispatchId)!
    expect(assignment.driverReassignmentHistory?.find((item) => item.changeId === latestEvent.changeId)).toMatchObject({ acknowledgedBy: 'demo-driver:demo-driver-001' })
    expect(assignment.driverReassignmentHistory?.find((item) => item.changeId === firstEvent?.changeId)?.acknowledgedAt).toBeUndefined()
    expect((await repository.snapshot()).auditLogs.some((item) => item.entityId === assignment.dispatchId && item.action === 'driverReassignmentAcknowledged')).toBe(true)
    repository.close()
  })

  it('予約状態・カテゴリー・日付・時刻・車両保留・担当者を保存時に検証する', async () => {
    const { repository, command } = await setup()
    expect((await repository.createDispatch(command(1, 'fluorescent'))).kind).toBe('reservationNotDispatchable')
    expect((await repository.createDispatch(command(3, 'received'))).kind).toBe('reservationNotDispatchable')
    expect((await repository.createDispatch(command(13, 'completed'))).kind).toBe('reservationNotDispatchable')
    expect((await repository.createDispatch(command(2, 'cancelled'))).kind).toBe('reservationNotDispatchable')
    expect((await repository.createDispatch({ ...command(10, 'date'), plannedDate: '2026-10-20' })).kind).toBe('validationError')
    expect((await repository.createDispatch({ ...command(10, 'time'), plannedEndTime: '09:00' })).kind).toBe('validationError')
    expect((await repository.createDispatch({ ...command(10, 'hold'), vehicleId: 'demo-vehicle-003' })).kind).toBe('vehicleOnHold')
    expect((await repository.createDispatch({ ...command(10, 'vehicle'), vehicleId: 'missing' })).kind).toBe('vehicleUnavailable')
    expect((await repository.createDispatch({ ...command(10, 'driver'), primaryDriverId: 'missing' })).kind).toBe('driverUnavailable')
    expect((await repository.createDispatch({ ...command(10, 'stale-version'), expectedReservationVersion: 0 })).kind).toBe('versionConflict')
    expect((await repository.snapshot()).dispatchAssignments).toHaveLength(7)
    repository.close()
  })

  it('車両・担当者の重複だけを拒否し、隣接時間を許可する', async () => {
    const { repository, metadata, reservation, command } = await setup()
    const created = await repository.createReservation({
      generationId: metadata.generationId, idempotencyKey: 'second-reservation', channel: 'admin', actor: 'demo-admin', detailsConfirmed: true,
      input: { categoryId: 'binkan', requestedDate: reservation(10).requestedDate, companyName: '架空事業所追加', contactName: '予約担当追加', phone: '03-0000-1000', address: '架空県架空市追加1番地', contactNotes: '', categoryAnswers: { typesAndQuantities: '空き缶 1袋' } },
    })
    expect(created.kind).toBe('success')
    const second = (await repository.snapshot()).reservations.find((item) => item.reservationId === (created.kind === 'success' ? created.payload.reservationId : ''))!
    const secondCommand = { ...command(10, 'second'), reservationId: second.reservationId, expectedReservationVersion: second.version }
    const first = await repository.createDispatch(command(10, 'first'))
    expect(first.kind).toBe('success')
    const vehicleConflict = await repository.createDispatch({ ...secondCommand, idempotencyKey: 'vehicle-conflict', primaryDriverId: 'demo-driver-002', plannedStartTime: '09:30' })
    const driverConflict = await repository.createDispatch({ ...secondCommand, idempotencyKey: 'driver-conflict', vehicleId: 'demo-vehicle-002', plannedStartTime: '09:30' })
    expect(vehicleConflict).toEqual({ kind: 'vehicleScheduleConflict', conflictingDispatchId: first.kind === 'success' ? first.payload.dispatchId : undefined })
    expect(driverConflict).toEqual({ kind: 'driverScheduleConflict', conflictingDispatchId: first.kind === 'success' ? first.payload.dispatchId : undefined })
    expect((await repository.createDispatch({ ...secondCommand, idempotencyKey: 'adjacent', plannedStartTime: '10:00', plannedEndTime: '11:00' })).kind).toBe('success')
    repository.close()
  })

  it('同じ予約への同時登録を直列化し、有効配車を1件に保つ', async () => {
    const { repository, command, reservation } = await setup()
    const results = await Promise.all([
      repository.createDispatch(command(10, 'parallel-a')),
      repository.createDispatch({ ...command(10, 'parallel-b'), vehicleId: 'demo-vehicle-002', primaryDriverId: 'demo-driver-002' }),
    ])
    expect(results.map((item) => item.kind).sort()).toEqual(['activeDispatchExists', 'success'])
    expect((await repository.snapshot()).dispatchAssignments.filter((item) => item.reservationId === reservation(10).reservationId)).toHaveLength(1)
    repository.close()
  })

  it('別予約から同じ車両・時間への同時登録も1件だけ成功させる', async () => {
    const { repository, metadata, reservation, command } = await setup()
    const created = await repository.createReservation({
      generationId: metadata.generationId, idempotencyKey: 'parallel-second-reservation', channel: 'admin', actor: 'demo-admin', detailsConfirmed: true,
      input: { categoryId: 'binkan', requestedDate: reservation(10).requestedDate, companyName: '架空事業所並行', contactName: '予約担当並行', phone: '03-0000-2000', address: '架空県架空市追加2番地', contactNotes: '', categoryAnswers: { typesAndQuantities: 'ビン 1箱' } },
    })
    expect(created.kind).toBe('success')
    const second = (await repository.snapshot()).reservations.find((item) => item.reservationId === (created.kind === 'success' ? created.payload.reservationId : ''))!
    const results = await Promise.all([
      repository.createDispatch(command(10, 'parallel-vehicle-a')),
      repository.createDispatch({ ...command(10, 'parallel-vehicle-b'), reservationId: second.reservationId, expectedReservationVersion: second.version, primaryDriverId: 'demo-driver-002' }),
    ])
    expect(results.filter((item) => item.kind === 'success')).toHaveLength(1)
    expect(results.filter((item) => item.kind === 'vehicleScheduleConflict')).toHaveLength(1)
    repository.close()
  })

  it('一部回収後の別日再配車はattempt 2となり、取消後は要再配車へ戻る', async () => {
    const { repository, metadata, reservation, command } = await setup()
    const input = { ...command(14, 'redispatch-14'), plannedDate: reservation(10).requestedDate }
    const created = await repository.createDispatch(input)
    expect(created.kind).toBe('success')
    if (created.kind !== 'success') throw new Error('再配車登録に失敗しました。')
    expect(created.payload.attemptNumber).toBe(2)
    const cancelled = await repository.cancelDispatch({
      generationId: metadata.generationId, idempotencyKey: 'cancel-redispatch-14', actor: 'demo-admin',
      reservationId: reservation(14).reservationId, expectedReservationVersion: reservation(14).version,
      dispatchId: created.payload.dispatchId!, expectedDispatchVersion: created.payload.dispatchVersion!,
    })
    expect(cancelled.kind).toBe('success')
    const snapshot = await repository.snapshot()
    expect(dispatchDisplayState(reservation(14), snapshot.dispatchAssignments.filter((item) => item.reservationId === reservation(14).reservationId)).state).toBe('needsRedispatch')
    repository.close()
  })

  it('assignedを同じ配車IDとattemptで変更し、終了済み・作業中は変更しない', async () => {
    const { repository, metadata, reservation } = await setup()
    const original = (await repository.snapshot()).dispatchAssignments.find((item) => item.reservationId === reservation(11).reservationId)!
    const command = {
      generationId: metadata.generationId, idempotencyKey: 'update-11', actor: 'demo-admin' as const,
      reservationId: reservation(11).reservationId, expectedReservationVersion: reservation(11).version,
      dispatchId: original.dispatchId, expectedDispatchVersion: original.version,
      plannedDate: original.plannedDate, plannedStartTime: '10:00', plannedEndTime: '11:00',
      vehicleId: 'demo-vehicle-002', primaryDriverId: 'demo-driver-002', driverInstructions: '入口で電話連絡',
    }
    const result = await repository.updateDispatch(command)
    const replay = await repository.updateDispatch(command)
    const updated = (await repository.snapshot()).dispatchAssignments.find((item) => item.dispatchId === original.dispatchId)!
    expect(result.kind).toBe('success')
    expect(replay.kind).toBe('duplicateSuccess')
    expect(updated).toMatchObject({ dispatchId: original.dispatchId, attemptNumber: original.attemptNumber, version: original.version + 1, vehicleId: 'demo-vehicle-002', primaryDriverId: 'demo-driver-002' })
    expect(updated.reservationSnapshotAtAssignment).toEqual(original.reservationSnapshotAtAssignment)
    expect((await repository.updateDispatch({ ...command, idempotencyKey: 'stale', expectedDispatchVersion: original.version })).kind).toBe('dispatchVersionConflict')
    const inProgress = (await repository.snapshot()).dispatchAssignments.find((item) => item.reservationId === reservation(12).reservationId)!
    expect((await repository.updateDispatch({ ...command, idempotencyKey: 'in-progress', reservationId: reservation(12).reservationId, expectedReservationVersion: reservation(12).version, dispatchId: inProgress.dispatchId, expectedDispatchVersion: inProgress.version, plannedDate: inProgress.plannedDate })).kind).toBe('invalidDispatchTransition')
    repository.close()
  })

  it('assignedを取り消して予約を維持し、次の配車はattemptを再利用しない', async () => {
    const { repository, metadata, reservation, command } = await setup()
    const original = (await repository.snapshot()).dispatchAssignments.find((item) => item.reservationId === reservation(11).reservationId)!
    const cancel = { generationId: metadata.generationId, idempotencyKey: 'cancel-11', actor: 'demo-admin' as const, reservationId: reservation(11).reservationId, expectedReservationVersion: reservation(11).version, dispatchId: original.dispatchId, expectedDispatchVersion: original.version, cancelReason: '作業前に日程を調整' }
    const result = await repository.cancelDispatch(cancel)
    expect(result.kind).toBe('success')
    expect((await repository.cancelDispatch(cancel)).kind).toBe('duplicateSuccess')
    const afterCancel = await repository.snapshot()
    expect(afterCancel.reservations.find((item) => item.reservationId === reservation(11).reservationId)?.status).toBe('confirmed')
    expect(dispatchDisplayState(reservation(11), afterCancel.dispatchAssignments.filter((item) => item.reservationId === reservation(11).reservationId)).state).toBe('unassigned')
    expect(afterCancel.auditLogs.filter((item) => item.entityId === original.dispatchId && item.action === 'dispatchCancelled')).toHaveLength(1)
    const next = await repository.createDispatch({ ...command(11, 'retry'), vehicleId: 'demo-vehicle-002', primaryDriverId: 'demo-driver-002' })
    expect(next.kind).toBe('success')
    if (next.kind === 'success') expect(next.payload.attemptNumber).toBe(2)
    const inProgress = afterCancel.dispatchAssignments.find((item) => item.reservationId === reservation(12).reservationId)!
    expect((await repository.cancelDispatch({ ...cancel, idempotencyKey: 'cancel-progress', reservationId: reservation(12).reservationId, expectedReservationVersion: reservation(12).version, dispatchId: inProgress.dispatchId, expectedDispatchVersion: inProgress.version })).kind).toBe('invalidDispatchTransition')
    repository.close()
  })

  it('予約取消はassigned配車も同時に取消し、回収中の取消と直接完了を拒否する', async () => {
    const { repository, metadata, reservation } = await setup()
    const cancel = await repository.changeStatus({
      generationId: metadata.generationId, idempotencyKey: 'cancel-reservation-11', actor: 'demo-admin',
      reservationId: reservation(11).reservationId, expectedVersion: reservation(11).version, nextStatus: 'cancelled', cancelReason: '作業前の予約取消',
    })
    expect(cancel.kind).toBe('success')
    const after = await repository.snapshot()
    expect(after.reservations.find((item) => item.reservationId === reservation(11).reservationId)?.status).toBe('cancelled')
    expect(after.dispatchAssignments.find((item) => item.reservationId === reservation(11).reservationId)?.status).toBe('cancelled')
    expect(after.auditLogs.some((item) => item.action === 'dispatchCancelled' && item.entityId === 'demo-dispatch-011')).toBe(true)
    expect((await repository.changeStatus({ generationId: metadata.generationId, idempotencyKey: 'cancel-progress-reservation', actor: 'demo-admin', reservationId: reservation(12).reservationId, expectedVersion: reservation(12).version, nextStatus: 'cancelled' })).kind).toBe('invalidTransition')
    expect((await repository.changeStatus({ generationId: metadata.generationId, idempotencyKey: 'direct-complete', actor: 'demo-admin', reservationId: reservation(10).reservationId, expectedVersion: reservation(10).version, nextStatus: 'completed' })).kind).toBe('invalidTransition')
    repository.close()
  })

  it('カテゴリー変更を拒否し、申告内容の変更だけを配車の要再確認にする', async () => {
    const { repository, metadata, reservation } = await setup()
    const target = reservation(11)
    const input = {
      categoryId: target.categoryId, requestedDate: target.requestedDate, companyName: target.companyName,
      contactName: target.contactName, phone: target.phoneDisplay, address: target.address,
      contactNotes: target.contactNotes, categoryAnswers: target.categoryAnswers,
    }
    expect((await repository.updateReservation({ generationId: metadata.generationId, idempotencyKey: 'category-change', actor: 'demo-admin', reservationId: target.reservationId, expectedVersion: target.version, input: { ...input, categoryId: 'kagu' } })).kind).toBe('invalidTransition')
    const nameChanged = await repository.updateReservation({ generationId: metadata.generationId, idempotencyKey: 'name-change', actor: 'demo-admin', reservationId: target.reservationId, expectedVersion: target.version, input: { ...input, companyName: '変更後の架空事業所' } })
    expect(nameChanged.kind).toBe('success')
    let assignment = (await repository.snapshot()).dispatchAssignments.find((item) => item.reservationId === target.reservationId)!
    expect(assignment.needsReview).toBe(false)
    expect(assignment.version).toBe(1)
    const quantityChanged = await repository.updateReservation({ generationId: metadata.generationId, idempotencyKey: 'quantity-change', actor: 'demo-admin', reservationId: target.reservationId, expectedVersion: 2, input: { ...input, companyName: '変更後の架空事業所', categoryAnswers: { typesAndQuantities: '空き缶 4袋' } } })
    expect(quantityChanged.kind).toBe('success')
    assignment = (await repository.snapshot()).dispatchAssignments.find((item) => item.reservationId === target.reservationId)!
    expect(assignment.needsReview).toBe(true)
    expect(assignment.version).toBe(2)
    expect(assignment.reservationVersionAtLastReview).toBe(1)
    expect((await repository.snapshot()).auditLogs.some((item) => item.action === 'dispatchReviewRequired' && item.entityId === assignment.dispatchId)).toBe(true)
    repository.close()
  })
})
