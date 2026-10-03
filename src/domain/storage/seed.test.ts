import { describe, expect, it } from 'vitest'
import { dispatchDisplayState, timeRangesOverlap } from '../dispatchRules'
import { isSunday } from '../dateRules'
import { createSeedData } from './seed'

const now = '2026-09-27T01:00:00.000Z'

describe('Ver2完全初期データ', () => {
  it.each(['2026-09-16', '2026-09-27', '2026-12-31'])('日付 %s で参照、上限、稼働日、予定の整合を保つ', (today) => {
    const seed = createSeedData(today, now, 'test-generation')
    const reservations = new Map(seed.reservations.map((item) => [item.reservationId, item]))
    const vehicles = new Map(seed.vehicles.map((item) => [item.vehicleId, item]))
    const drivers = new Map(seed.drivers.map((item) => [item.driverId, item]))

    expect(seed.reservations.map((item) => item.reservationCode)).toEqual(
      Array.from({ length: 17 }, (_, index) => `DEMO-${String(index + 1).padStart(3, '0')}`),
    )
    expect(seed.dispatchAssignments).toHaveLength(7)
    expect(seed.internalNotes).toHaveLength(3)
    expect(seed.vehicles.map((item) => item.vehicleCode)).toEqual(['VEH-0001', 'VEH-0002', 'VEH-0003'])
    expect(seed.vehicles.every((item) => Boolean(item.registrationNumber) && !item.displayName)).toBe(true)
    if (!isSunday(today)) expect(reservations.get('demo-reservation-012')?.requestedDate).toBe(today)
    for (const assignment of seed.dispatchAssignments) {
      const reservation = reservations.get(assignment.reservationId)
      expect(reservation).toBeDefined()
      expect(vehicles.has(assignment.vehicleId)).toBe(true)
      expect(drivers.has(assignment.primaryDriverId)).toBe(true)
      expect(assignment.plannedDate).toBe(reservation?.requestedDate)
      expect(isSunday(assignment.plannedDate)).toBe(false)
      expect(assignment.plannedStartTime < assignment.plannedEndTime).toBe(true)
    }
    for (const note of seed.internalNotes) expect(reservations.has(note.reservationId)).toBe(true)
    for (const vehicle of seed.vehicles) {
      if (!vehicle.loadHold) continue
      const assignment = seed.dispatchAssignments.find((item) => item.dispatchId === vehicle.loadHold?.dispatchId)
      expect(assignment).toMatchObject({ reservationId: vehicle.loadHold.reservationId, vehicleId: vehicle.vehicleId, status: 'completed', outcome: 'allCollected' })
      expect(seed.dispatchAssignments.some((item) => item.vehicleId === vehicle.vehicleId && (item.status === 'assigned' || item.status === 'inProgress'))).toBe(false)
    }
    const capacity = new Map<string, number>()
    for (const reservation of seed.reservations) {
      if (reservation.status === 'cancelled') continue
      const key = `${reservation.requestedDate}:${reservation.categoryId}`
      capacity.set(key, (capacity.get(key) ?? 0) + 1)
    }
    expect([...capacity].filter(([, count]) => count > 2)).toEqual([[`${seed.reservations[5].requestedDate}:keikoukan`, 3]])

    const active = seed.dispatchAssignments.filter((item) => item.status === 'assigned' || item.status === 'inProgress')
    for (let i = 0; i < active.length; i += 1) {
      for (let j = i + 1; j < active.length; j += 1) {
        if (active[i].vehicleId === active[j].vehicleId || active[i].primaryDriverId === active[j].primaryDriverId) {
          expect(timeRangesOverlap(active[i], active[j])).toBe(false)
        }
      }
    }
  })

  it('各デモ予約が設計上の配車状態を表し、要再確認には予約差分を持つ', () => {
    const seed = createSeedData('2026-09-27', now, 'test-generation')
    const stateFor = (number: number) => {
      const reservation = seed.reservations[number - 1]
      return dispatchDisplayState(reservation, seed.dispatchAssignments.filter((item) => item.reservationId === reservation.reservationId))
    }
    expect(stateFor(1).state).toBe('notDispatchable')
    expect(stateFor(10).state).toBe('unassigned')
    expect(stateFor(11).state).toBe('assigned')
    expect(stateFor(12).state).toBe('inProgress')
    expect(stateFor(13).state).toBe('allCollected')
    expect(stateFor(14).state).toBe('needsRedispatch')
    expect(stateFor(15).state).toBe('needsAttention')
    expect(stateFor(16)).toEqual({ state: 'assigned', needsReview: true })
    expect(stateFor(17).state).toBe('allCollected')

    const assignment = seed.dispatchAssignments.find((item) => item.reservationId === 'demo-reservation-016')!
    expect(assignment.reservationVersionAtAssignment).toBe(1)
    expect(seed.reservations[15].version).toBe(2)
    expect(assignment.reservationSnapshotAtLastReview.categoryAnswers).not.toEqual(seed.reservations[15].categoryAnswers)
    expect(assignment.reservationChangeHistory).toHaveLength(1)
    expect(assignment.reservationChangeHistory?.[0]).toMatchObject({ reservationVersion: 2, before: { categoryAnswers: { itemsAndQuantities: '棚 1台' } }, after: { categoryAnswers: { itemsAndQuantities: '棚 2台' } } })
    expect(seed.vehicles.find((item) => item.vehicleId === 'demo-vehicle-003')?.loadHold?.status).toBe('storedOnVehicle')
    expect(seed.auditLogs.some((item) => item.action === 'updated' && item.entityId === 'demo-reservation-016')).toBe(true)
    expect(seed.auditLogs.some((item) => item.entityType === 'internalNote' && 'body' in (item.after ?? {}))).toBe(false)
  })
})
