import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it } from 'vitest'
import { driverReviewRequired, snapshotForDispatch } from '../dispatchTypes'
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
  return { repository, generationId: metadata.generationId, databaseName: name }
}

async function removeStoredChangeHistory(databaseName: string, dispatchId: string) {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const transaction = database.transaction('dispatchAssignments', 'readwrite')
  const store = transaction.objectStore('dispatchAssignments')
  const assignment = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const request = store.get(dispatchId)
    request.onsuccess = () => resolve(request.result as Record<string, unknown>)
    request.onerror = () => reject(request.error)
  })
  delete assignment.reservationChangeHistory
  store.put(assignment)
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  database.close()
}

describe('配車の変更確認済み保存', () => {
  it('管理者の確認後もドライバーを未確認のままにし、担当ドライバーの確認で解除する', async () => {
    const { repository, generationId } = await setup()
    let snapshot = await repository.snapshot()
    const reservation = snapshot.reservations.find((item) => item.reservationId === 'demo-reservation-016')!
    let assignment = snapshot.dispatchAssignments.find((item) => item.reservationId === reservation.reservationId)!
    expect(driverReviewRequired(assignment)).toBe(true)

    expect((await repository.acknowledgeDispatchReview({ generationId, idempotencyKey: 'admin-ack-16', actor: 'demo-admin', reservationId: reservation.reservationId, expectedReservationVersion: reservation.version, dispatchId: assignment.dispatchId, expectedDispatchVersion: assignment.version })).kind).toBe('success')
    snapshot = await repository.snapshot()
    assignment = snapshot.dispatchAssignments.find((item) => item.dispatchId === assignment.dispatchId)!
    expect(assignment.needsReview).toBe(false)
    expect(driverReviewRequired(assignment)).toBe(true)
    expect((await repository.acknowledgeDriverReview({ generationId, idempotencyKey: 'wrong-driver-ack-16', actor: 'demo-driver:demo-driver-002', reservationId: reservation.reservationId, expectedReservationVersion: reservation.version, dispatchId: assignment.dispatchId, expectedDispatchVersion: assignment.version })).kind).toBe('invalidDispatchTransition')

    const acknowledged = await repository.acknowledgeDriverReview({ generationId, idempotencyKey: 'driver-ack-16', actor: 'demo-driver:demo-driver-001', reservationId: reservation.reservationId, expectedReservationVersion: reservation.version, dispatchId: assignment.dispatchId, expectedDispatchVersion: assignment.version })
    expect(acknowledged.kind).toBe('success')
    snapshot = await repository.snapshot()
    assignment = snapshot.dispatchAssignments.find((item) => item.dispatchId === assignment.dispatchId)!
    expect(driverReviewRequired(assignment)).toBe(false)
    expect(assignment).toMatchObject({ driverAcknowledgedDriverId: 'demo-driver-001', driverAcknowledgedBy: 'demo-driver:demo-driver-001' })
    expect(snapshot.auditLogs.some((item) => item.entityId === assignment.dispatchId && item.action === 'driverReviewAcknowledged')).toBe(true)
    repository.close()
  })

  it('ドライバー確認後の再変更と配車変更で再び要確認にする', async () => {
    const { repository, generationId } = await setup()
    let snapshot = await repository.snapshot()
    let reservation = snapshot.reservations.find((item) => item.reservationId === 'demo-reservation-016')!
    let assignment = snapshot.dispatchAssignments.find((item) => item.reservationId === reservation.reservationId)!
    expect((await repository.acknowledgeDriverReview({ generationId, idempotencyKey: 'driver-first-ack-16', actor: 'demo-driver:demo-driver-001', reservationId: reservation.reservationId, expectedReservationVersion: reservation.version, dispatchId: assignment.dispatchId, expectedDispatchVersion: assignment.version })).kind).toBe('success')
    snapshot = await repository.snapshot()
    assignment = snapshot.dispatchAssignments.find((item) => item.dispatchId === assignment.dispatchId)!

    expect((await repository.updateDispatch({ generationId, idempotencyKey: 'driver-instruction-change-16', actor: 'demo-admin', reservationId: reservation.reservationId, expectedReservationVersion: reservation.version, dispatchId: assignment.dispatchId, expectedDispatchVersion: assignment.version, plannedDate: assignment.plannedDate, plannedStartTime: assignment.plannedStartTime, plannedEndTime: assignment.plannedEndTime, vehicleId: assignment.vehicleId, primaryDriverId: assignment.primaryDriverId, driverInstructions: '裏口へ到着後に電話' })).kind).toBe('success')
    snapshot = await repository.snapshot()
    assignment = snapshot.dispatchAssignments.find((item) => item.dispatchId === assignment.dispatchId)!
    expect(driverReviewRequired(assignment)).toBe(true)

    expect((await repository.acknowledgeDriverReview({ generationId, idempotencyKey: 'driver-second-ack-16', actor: 'demo-driver:demo-driver-001', reservationId: reservation.reservationId, expectedReservationVersion: reservation.version, dispatchId: assignment.dispatchId, expectedDispatchVersion: assignment.version })).kind).toBe('success')
    snapshot = await repository.snapshot()
    assignment = snapshot.dispatchAssignments.find((item) => item.dispatchId === assignment.dispatchId)!
    reservation = snapshot.reservations.find((item) => item.reservationId === reservation.reservationId)!
    expect((await repository.updateReservation({ generationId, idempotencyKey: 'reservation-change-after-driver-ack-16', actor: 'demo-admin', reservationId: reservation.reservationId, expectedVersion: reservation.version, input: { categoryId: reservation.categoryId, requestedDate: reservation.requestedDate, companyName: reservation.companyName, contactName: reservation.contactName, phone: reservation.phoneDisplay, address: reservation.address, contactNotes: '到着前に連絡', categoryAnswers: reservation.categoryAnswers } })).kind).toBe('success')
    assignment = (await repository.snapshot()).dispatchAssignments.find((item) => item.dispatchId === assignment.dispatchId)!
    expect(driverReviewRequired(assignment)).toBe(true)
    repository.close()
  })

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
    expect(updated.reservationChangeHistory).toEqual(assignment.reservationChangeHistory)
    expect(updated.reservationChangeHistory?.[0]).toMatchObject({ reservationVersion: 2 })
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
    const afterAcknowledgement = (await repository.snapshot()).dispatchAssignments.find((item) => item.dispatchId === assignment.dispatchId)!
    expect(afterAcknowledgement).toMatchObject({ plannedDate: newDate, needsReview: false, reservationVersionAtLastReview: updatedReservation.version })
    expect(afterAcknowledgement.reservationChangeHistory).toHaveLength(1)
    expect(afterAcknowledgement.reservationChangeHistory?.[0]).toMatchObject({ reservationVersion: updatedReservation.version, before: { requestedDate: reservation.requestedDate }, after: { requestedDate: newDate } })
    repository.close()
  })

  it('配車後の複数回の予約変更を順番に保存し、確認後も消さない', async () => {
    const { repository, generationId } = await setup()
    let snapshot = await repository.snapshot()
    let reservation = snapshot.reservations.find((item) => item.reservationId === 'demo-reservation-011')!
    const assignment = snapshot.dispatchAssignments.find((item) => item.reservationId === reservation.reservationId)!
    const update = (itemsAndQuantities: string, idempotencyKey: string) => repository.updateReservation({
      generationId, idempotencyKey, actor: 'demo-admin', reservationId: reservation.reservationId, expectedVersion: reservation.version,
      input: { categoryId: reservation.categoryId, requestedDate: reservation.requestedDate, companyName: reservation.companyName, contactName: reservation.contactName, phone: reservation.phoneDisplay, address: reservation.address, contactNotes: reservation.contactNotes, categoryAnswers: { ...reservation.categoryAnswers, typesAndQuantities: itemsAndQuantities } },
    })

    expect((await update('空き缶 3袋', 'change-11-1')).kind).toBe('success')
    snapshot = await repository.snapshot()
    reservation = snapshot.reservations.find((item) => item.reservationId === reservation.reservationId)!
    expect((await update('空き缶 4袋', 'change-11-2')).kind).toBe('success')
    snapshot = await repository.snapshot()
    reservation = snapshot.reservations.find((item) => item.reservationId === reservation.reservationId)!
    let updatedAssignment = snapshot.dispatchAssignments.find((item) => item.dispatchId === assignment.dispatchId)!

    expect(updatedAssignment.reservationChangeHistory).toHaveLength(2)
    expect(updatedAssignment.reservationChangeHistory?.map((change) => change.reservationVersion)).toEqual([2, 3])
    expect(updatedAssignment.reservationChangeHistory?.[0].after.categoryAnswers.typesAndQuantities).toBe('空き缶 3袋')
    expect(updatedAssignment.reservationChangeHistory?.[1].before.categoryAnswers.typesAndQuantities).toBe('空き缶 3袋')

    expect((await repository.acknowledgeDispatchReview({ generationId, idempotencyKey: 'ack-11-history', actor: 'demo-admin', reservationId: reservation.reservationId, expectedReservationVersion: reservation.version, dispatchId: assignment.dispatchId, expectedDispatchVersion: updatedAssignment.version })).kind).toBe('success')
    updatedAssignment = (await repository.snapshot()).dispatchAssignments.find((item) => item.dispatchId === assignment.dispatchId)!
    expect(updatedAssignment.needsReview).toBe(false)
    expect(updatedAssignment.reservationChangeHistory).toHaveLength(2)
    repository.close()
  })

  it('既に確認済みの旧データは予約監査記録から変更履歴を補完する', async () => {
    const { repository, generationId, databaseName } = await setup()
    let snapshot = await repository.snapshot()
    let reservation = snapshot.reservations.find((item) => item.reservationId === 'demo-reservation-011')!
    let assignment = snapshot.dispatchAssignments.find((item) => item.reservationId === reservation.reservationId)!
    const originalContactNotes = reservation.contactNotes
    expect((await repository.updateReservation({
      generationId, idempotencyKey: 'legacy-change-11', actor: 'demo-admin', reservationId: reservation.reservationId, expectedVersion: reservation.version,
      input: { categoryId: reservation.categoryId, requestedDate: reservation.requestedDate, companyName: reservation.companyName, contactName: reservation.contactName, phone: reservation.phoneDisplay, address: reservation.address, contactNotes: '門前で電話してください', categoryAnswers: reservation.categoryAnswers },
    })).kind).toBe('success')
    snapshot = await repository.snapshot()
    reservation = snapshot.reservations.find((item) => item.reservationId === reservation.reservationId)!
    assignment = snapshot.dispatchAssignments.find((item) => item.dispatchId === assignment.dispatchId)!
    expect((await repository.acknowledgeDispatchReview({ generationId, idempotencyKey: 'legacy-ack-11', actor: 'demo-admin', reservationId: reservation.reservationId, expectedReservationVersion: reservation.version, dispatchId: assignment.dispatchId, expectedDispatchVersion: assignment.version })).kind).toBe('success')
    await removeStoredChangeHistory(databaseName, assignment.dispatchId)
    repository.close()

    const reopened = new ReservationRepository({ databaseName, now: () => new Date('2026-09-27T02:00:00.000Z'), today: () => '2026-09-27' })
    await reopened.ensureInitialized()
    const migrated = (await reopened.snapshot()).dispatchAssignments.find((item) => item.dispatchId === assignment.dispatchId)!
    expect(migrated.needsReview).toBe(false)
    expect(migrated.reservationChangeHistory).toHaveLength(1)
    expect(driverReviewRequired(migrated)).toBe(true)
    expect(migrated.reservationChangeHistory?.[0]).toMatchObject({ before: { contactNotes: originalContactNotes }, after: { contactNotes: '門前で電話してください' } })
    reopened.close()
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
