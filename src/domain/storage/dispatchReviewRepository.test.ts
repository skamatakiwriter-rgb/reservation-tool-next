import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it } from 'vitest'
import { snapshotForDispatch } from '../dispatchTypes'
import { deleteReservationDatabase } from './idb'
import { ReservationRepository } from './repository'

const names: string[] = []

afterEach(async () => {
  for (const name of names.splice(0)) await deleteReservationDatabase(name)
})

async function setup() {
  const name = `dispatch-review-${crypto.randomUUID()}`
  names.push(name)
  let sequence = 0
  const repository = new ReservationRepository({ databaseName: name, now: () => new Date('2026-09-27T01:00:00.000Z'), today: () => '2026-09-27', createId: () => `review-test-id-${++sequence}` })
  const { metadata } = await repository.ensureInitialized()
  return { repository, generationId: metadata.generationId }
}

describe('配車の変更確認済み保存', () => {
  it('最新の予約版とスナップショットを確認基準にし、割当時記録は変更しない', async () => {
    const { repository, generationId } = await setup()
    const before = await repository.snapshot()
    const reservation = before.reservations.find((item) => item.reservationId === 'demo-reservation-016')!
    const assignment = before.dispatchAssignments.find((item) => item.reservationId === reservation.reservationId)!
    const command = { generationId, idempotencyKey: 'ack-16', actor: 'demo-admin' as const, reservationId: reservation.reservationId, expectedReservationVersion: reservation.version, dispatchId: assignment.dispatchId, expectedDispatchVersion: assignment.version }
    const result = await repository.acknowledgeDispatchReview(command)
    const replay = await repository.acknowledgeDispatchReview(command)
    const after = await repository.snapshot()
    const updated = after.dispatchAssignments.find((item) => item.dispatchId === assignment.dispatchId)!

    expect(result.kind).toBe('success')
    expect(replay.kind).toBe('duplicateSuccess')
    expect(updated).toMatchObject({ needsReview: false, reservationVersionAtAssignment: assignment.reservationVersionAtAssignment, reservationVersionAtLastReview: reservation.version, version: assignment.version + 1 })
    expect(updated.reservationSnapshotAtAssignment).toEqual(assignment.reservationSnapshotAtAssignment)
    expect(updated.reservationSnapshotAtLastReview).toEqual(snapshotForDispatch(reservation))
    expect(after.auditLogs.filter((item) => item.entityId === assignment.dispatchId && item.action === 'dispatchReviewAcknowledged')).toHaveLength(1)
    expect(JSON.stringify(after.auditLogs.find((item) => item.action === 'dispatchReviewAcknowledged'))).not.toContain(reservation.address)
    repository.close()
  })

  it('予約日変更後は配車予定日を合わせてから確認済みにする', async () => {
    const { repository, generationId } = await setup()
    const before = await repository.snapshot()
    const reservation = before.reservations.find((item) => item.reservationId === 'demo-reservation-011')!
    const assignment = before.dispatchAssignments.find((item) => item.reservationId === reservation.reservationId)!
    const newDate = '2026-10-15'
    const changed = await repository.updateReservation({
      generationId, idempotencyKey: 'move-reservation-11', actor: 'demo-admin', reservationId: reservation.reservationId, expectedVersion: reservation.version,
      input: { categoryId: reservation.categoryId, requestedDate: newDate, companyName: reservation.companyName, contactName: reservation.contactName, phone: reservation.phoneDisplay, address: reservation.address, contactNotes: reservation.contactNotes, categoryAnswers: reservation.categoryAnswers },
    })
    expect(changed.kind).toBe('success')
    let current = await repository.snapshot()
    let updatedReservation = current.reservations.find((item) => item.reservationId === reservation.reservationId)!
    let updatedAssignment = current.dispatchAssignments.find((item) => item.dispatchId === assignment.dispatchId)!
    expect(updatedAssignment).toMatchObject({ needsReview: true, plannedDate: assignment.plannedDate, version: assignment.version + 1 })
    expect((await repository.acknowledgeDispatchReview({ generationId, idempotencyKey: 'ack-before-move', actor: 'demo-admin', reservationId: reservation.reservationId, expectedReservationVersion: updatedReservation.version, dispatchId: assignment.dispatchId, expectedDispatchVersion: updatedAssignment.version })).kind).toBe('invalidDispatchTransition')

    const moved = await repository.updateDispatch({
      generationId, idempotencyKey: 'move-dispatch-11', actor: 'demo-admin', reservationId: reservation.reservationId, expectedReservationVersion: updatedReservation.version,
      dispatchId: assignment.dispatchId, expectedDispatchVersion: updatedAssignment.version,
      plannedDate: newDate, plannedStartTime: assignment.plannedStartTime, plannedEndTime: assignment.plannedEndTime,
      vehicleId: assignment.vehicleId, primaryDriverId: assignment.primaryDriverId, driverInstructions: assignment.driverInstructions,
    })
    expect(moved.kind).toBe('success')
    current = await repository.snapshot()
    updatedReservation = current.reservations.find((item) => item.reservationId === reservation.reservationId)!
    updatedAssignment = current.dispatchAssignments.find((item) => item.dispatchId === assignment.dispatchId)!
    const acknowledged = await repository.acknowledgeDispatchReview({ generationId, idempotencyKey: 'ack-after-move', actor: 'demo-admin', reservationId: reservation.reservationId, expectedReservationVersion: updatedReservation.version, dispatchId: assignment.dispatchId, expectedDispatchVersion: updatedAssignment.version })
    expect(acknowledged.kind).toBe('success')
    expect((await repository.snapshot()).dispatchAssignments.find((item) => item.dispatchId === assignment.dispatchId)).toMatchObject({ plannedDate: newDate, needsReview: false, reservationVersionAtLastReview: updatedReservation.version })
    repository.close()
  })

  it('古い版、確認不要、終了済み、ドライバー操作を拒否する', async () => {
    const { repository, generationId } = await setup()
    const snapshot = await repository.snapshot()
    const reservation = snapshot.reservations.find((item) => item.reservationId === 'demo-reservation-016')!
    const assignment = snapshot.dispatchAssignments.find((item) => item.reservationId === reservation.reservationId)!
    const base = { generationId, actor: 'demo-admin' as const, reservationId: reservation.reservationId, expectedReservationVersion: reservation.version, dispatchId: assignment.dispatchId, expectedDispatchVersion: assignment.version }
    expect((await repository.acknowledgeDispatchReview({ ...base, idempotencyKey: 'old-reservation', expectedReservationVersion: 1 })).kind).toBe('versionConflict')
    expect((await repository.acknowledgeDispatchReview({ ...base, idempotencyKey: 'old-dispatch', expectedDispatchVersion: 0 })).kind).toBe('dispatchVersionConflict')
    expect((await repository.acknowledgeDispatchReview({ ...base, idempotencyKey: 'driver-ack', actor: 'demo-driver:demo-driver-001' })).kind).toBe('invalidTransition')
    const success = await repository.acknowledgeDispatchReview({ ...base, idempotencyKey: 'success' })
    expect(success.kind).toBe('success')
    expect((await repository.acknowledgeDispatchReview({ ...base, idempotencyKey: 'already', expectedDispatchVersion: assignment.version + 1 })).kind).toBe('invalidDispatchTransition')
    repository.close()
  })
})
