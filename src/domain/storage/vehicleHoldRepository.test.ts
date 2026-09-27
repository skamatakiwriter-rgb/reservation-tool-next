import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it } from 'vitest'
import { deleteReservationDatabase } from './idb'
import { ReservationRepository } from './repository'

const names: string[] = []

afterEach(async () => {
  for (const name of names.splice(0)) await deleteReservationDatabase(name)
})

async function setup() {
  const name = `vehicle-hold-${crypto.randomUUID()}`
  names.push(name)
  let sequence = 0
  const repository = new ReservationRepository({ databaseName: name, now: () => new Date('2026-09-27T01:00:00.000Z'), today: () => '2026-09-27', createId: () => `vehicle-hold-id-${++sequence}` })
  const { metadata } = await repository.ensureInitialized()
  return { repository, generationId: metadata.generationId }
}

describe('車両の搬入判断待ち・積み置き・解除', () => {
  it('終了済み回収を根拠に保留し、電話相談後に積み置き、理由を残して解除する', async () => {
    const { repository, generationId } = await setup()
    const started = await repository.startVehicleLoadHold({
      generationId, idempotencyKey: 'hold-start', actor: 'demo-admin', vehicleId: 'demo-vehicle-001', expectedVehicleVersion: 1,
      reservationId: 'demo-reservation-013', dispatchId: 'demo-dispatch-013', reason: '搬入先が受入停止',
    })
    expect(started.kind).toBe('success')
    expect((await repository.snapshot()).vehicles.find((item) => item.vehicleId === 'demo-vehicle-001')).toMatchObject({ version: 2, loadHold: { status: 'decisionPending', dispatchId: 'demo-dispatch-013' } })
    const confirmCommand = { generationId, idempotencyKey: 'hold-confirm', actor: 'demo-admin' as const, vehicleId: 'demo-vehicle-001', expectedVehicleVersion: 2, consultationNote: '電話相談の結果、車上保管を決定' }
    const confirmed = await repository.confirmVehicleLoadHold(confirmCommand)
    expect(confirmed.kind).toBe('success')
    expect((await repository.confirmVehicleLoadHold(confirmCommand)).kind).toBe('duplicateSuccess')
    expect((await repository.confirmVehicleLoadHold({ ...confirmCommand, idempotencyKey: 'old-confirm' })).kind).toBe('vehicleVersionConflict')
    expect((await repository.snapshot()).vehicles.find((item) => item.vehicleId === 'demo-vehicle-001')).toMatchObject({ version: 3, loadHold: { status: 'storedOnVehicle', consultationNote: '電話相談の結果、車上保管を決定' } })
    const releaseCommand = { generationId, idempotencyKey: 'hold-release', actor: 'demo-admin' as const, vehicleId: 'demo-vehicle-001', expectedVehicleVersion: 3, reason: '搬入を終え積載を解消' }
    const released = await repository.releaseVehicleLoadHold(releaseCommand)
    const snapshot = await repository.snapshot()
    expect(released.kind).toBe('success')
    expect((await repository.releaseVehicleLoadHold(releaseCommand)).kind).toBe('duplicateSuccess')
    expect((await repository.releaseVehicleLoadHold({ ...releaseCommand, idempotencyKey: 'old-release' })).kind).toBe('vehicleVersionConflict')
    expect(snapshot.vehicles.find((item) => item.vehicleId === 'demo-vehicle-001')).toMatchObject({ version: 4, loadHold: undefined })
    expect(snapshot.auditLogs.filter((item) => item.entityId === 'demo-vehicle-001').map((item) => item.action)).toEqual(['loadHoldStarted', 'loadHoldConfirmed', 'loadHoldReleased'])
    expect(snapshot.auditLogs.find((item) => item.action === 'loadHoldReleased')?.note).toBe('搬入を終え積載を解消')
    const reservation = snapshot.reservations.find((item) => item.reservationId === 'demo-reservation-010')!
    expect((await repository.createDispatch({ generationId, idempotencyKey: 'after-release', actor: 'demo-admin', reservationId: reservation.reservationId, expectedReservationVersion: reservation.version, plannedDate: reservation.requestedDate, plannedStartTime: '09:00', plannedEndTime: '10:00', vehicleId: 'demo-vehicle-001', primaryDriverId: 'demo-driver-001' })).kind).toBe('success')
    repository.close()
  })

  it('同じ操作の再送、古い車両版、根拠のない保留を拒否する', async () => {
    const { repository, generationId } = await setup()
    const command = { generationId, idempotencyKey: 'start-once', actor: 'demo-admin' as const, vehicleId: 'demo-vehicle-001', expectedVehicleVersion: 1, reservationId: 'demo-reservation-013', dispatchId: 'demo-dispatch-013', reason: '搬入先へ持ち込めない' }
    const first = await repository.startVehicleLoadHold(command)
    expect(first.kind).toBe('success')
    expect((await repository.startVehicleLoadHold(command)).kind).toBe('duplicateSuccess')
    expect((await repository.startVehicleLoadHold({ ...command, idempotencyKey: 'stale' })).kind).toBe('vehicleVersionConflict')
    expect((await repository.confirmVehicleLoadHold({ generationId, idempotencyKey: 'no-note', actor: 'demo-admin', vehicleId: 'demo-vehicle-001', expectedVehicleVersion: 2, consultationNote: '' })).kind).toBe('validationError')
    expect((await repository.releaseVehicleLoadHold({ generationId, idempotencyKey: 'no-reason', actor: 'demo-admin', vehicleId: 'demo-vehicle-001', expectedVehicleVersion: 2, reason: '' })).kind).toBe('validationError')
    expect((await repository.startVehicleLoadHold({ ...command, idempotencyKey: 'not-collected', dispatchId: 'demo-dispatch-015', reservationId: 'demo-reservation-015' })).kind).toBe('invalidDispatchTransition')
    expect((await repository.startVehicleLoadHold({ ...command, idempotencyKey: 'driver', actor: 'demo-driver:demo-driver-001' })).kind).toBe('invalidTransition')
    expect((await repository.snapshot()).auditLogs.filter((item) => item.entityId === 'demo-vehicle-001' && item.action === 'loadHoldStarted')).toHaveLength(1)
    repository.close()
  })
})
