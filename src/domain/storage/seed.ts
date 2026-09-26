import { addCalendarDays, isSunday } from '../dateRules'
import type { DispatchAssignment, Driver, InternalNote, Vehicle } from '../dispatchTypes'
import type { AuditLog, CategoryId, CategorySetting, Closure, DemoMetadata, Reservation } from '../types'
import { SCHEMA_VERSION, SEED_VERSION } from './schema'

export type SeedData = {
  metadata: DemoMetadata
  reservations: Reservation[]
  settings: CategorySetting[]
  closures: Closure[]
  auditLogs: AuditLog[]
  vehicles: Vehicle[]
  drivers: Driver[]
  dispatchAssignments: DispatchAssignment[]
  internalNotes: InternalNote[]
}

export function createVehicleSeed(): Vehicle[] {
  return [
    { vehicleId: 'demo-vehicle-001', vehicleCode: 'VEH-DEMO-001', displayName: '2t平ボディ1号', vehicleType: '2t平ボディ', isActive: true, version: 1 },
    { vehicleId: 'demo-vehicle-002', vehicleCode: 'VEH-DEMO-002', displayName: '2t箱車1号', vehicleType: '2t箱車', isActive: true, version: 1 },
    { vehicleId: 'demo-vehicle-003', vehicleCode: 'VEH-DEMO-003', displayName: 'パッカー車1号', vehicleType: 'パッカー車', isActive: true, version: 1 },
  ]
}

export function createDriverSeed(): Driver[] {
  return [
    { driverId: 'demo-driver-001', driverCode: 'DRV-DEMO-001', displayName: '収集担当A', isActive: true, version: 1 },
    { driverId: 'demo-driver-002', driverCode: 'DRV-DEMO-002', displayName: '収集担当B', isActive: true, version: 1 },
    { driverId: 'demo-driver-003', driverCode: 'DRV-DEMO-003', displayName: '収集担当C', isActive: true, version: 1 },
  ]
}

export function createSeedData(today: string, now: string, generationId: string): SeedData {
  const [p1, p2] = previousOpenDates(today, 2)
  const [, f2, f3, f4] = futureOpenDates(addCalendarDays(today, 3), 4)
  const sharedGroupId = 'demo-work-group-006'
  const sharedGroupCode = 'GROUP-DEMO-006'
  const cancelledReservation = makeReservation(2, p1, 'kagu', 'cancelled', now, { itemsAndQuantities: '事務机 1台、椅子 2脚' })
  const reacceptedReservation: Reservation = {
    ...makeReservation(9, isSunday(today) ? addCalendarDays(today, 1) : today, 'kagu', 'confirmed', now, { itemsAndQuantities: '事務机 1台、椅子 2脚' }),
    companyName: cancelledReservation.companyName,
    contactName: cancelledReservation.contactName,
    phoneDisplay: cancelledReservation.phoneDisplay,
    phoneNormalized: cancelledReservation.phoneNormalized,
    address: cancelledReservation.address,
    sourceReservationId: cancelledReservation.reservationId,
    createdAt: now,
    confirmedAt: now,
    updatedAt: now,
  }

  const reservations: Reservation[] = [
    makeReservation(1, p2, 'keikoukan', 'completed', now, { approximateTubeCount: 24 }),
    cancelledReservation,
    makeReservation(3, f2, 'binkan', 'received', now, { typesAndQuantities: '空き缶 3袋' }),
    makeReservation(4, f2, 'binkan', 'received', now, { typesAndQuantities: 'ビン 2箱' }),
    makeReservation(5, f3, 'kagu', 'confirmed', now, { itemsAndQuantities: '書庫 1台' }),
    makeReservation(6, f4, 'keikoukan', 'confirmed', now, { approximateTubeCount: 30 }, sharedGroupId, sharedGroupCode),
    makeReservation(7, f4, 'keikoukan', 'confirmed', now, { approximateTubeCount: 18 }, sharedGroupId, sharedGroupCode),
    { ...makeReservation(8, f4, 'keikoukan', 'confirmed', now, { approximateTubeCount: 12 }, sharedGroupId, sharedGroupCode), overrideType: 'fullCapacity' },
    reacceptedReservation,
  ]

  const settings: CategorySetting[] = (['keikoukan', 'kagu', 'binkan'] satisfies CategoryId[]).map((categoryId) => ({
    categoryId,
    dailyLimit: 2,
    version: 1,
    updatedAt: now,
    updatedBy: 'demo-system',
  }))

  const closure: Closure = {
    closureId: `closure-${f3}-kagu`,
    date: f3,
    categoryId: 'kagu',
    isClosed: true,
    version: 1,
    createdAt: now,
    createdBy: 'demo-system',
    updatedAt: now,
    updatedBy: 'demo-system',
  }

  return {
    metadata: {
      key: 'demo',
      schemaVersion: SCHEMA_VERSION,
      seedVersion: SEED_VERSION,
      generationId,
      lifecycleState: 'active',
      lastUsedAt: now,
      updatedAt: now,
    },
    reservations,
    settings,
    closures: [closure],
    vehicles: createVehicleSeed(),
    drivers: createDriverSeed(),
    dispatchAssignments: [],
    internalNotes: [],
    auditLogs: [
      ...reservations.flatMap((reservation) => createSeedAuditLogs(reservation, now)),
      {
        auditId: `${cancelledReservation.reservationId}-reaccepted-as`,
        entityType: 'reservation',
        entityId: cancelledReservation.reservationId,
        action: 'reacceptedAs',
        after: { reservationId: reacceptedReservation.reservationId, reservationCode: reacceptedReservation.reservationCode, requestedDate: reacceptedReservation.requestedDate, status: reacceptedReservation.status },
        actor: 'demo-system',
        occurredAt: now,
        relatedReservationId: reacceptedReservation.reservationId,
      },
    ],
  }
}

function makeReservation(
  number: number,
  requestedDate: string,
  categoryId: CategoryId,
  status: Reservation['status'],
  now: string,
  categoryAnswers: Record<string, unknown>,
  workGroupId = `demo-work-group-${String(number).padStart(3, '0')}`,
  workGroupCode = `GROUP-DEMO-${String(number).padStart(3, '0')}`,
): Reservation {
  const suffix = String(number).padStart(3, '0')
  const isFluorescent = categoryId === 'keikoukan'
  const createdAt = minutesBefore(now, 3)
  const reservation: Reservation = {
    reservationId: `demo-reservation-${suffix}`,
    reservationCode: `DEMO-${suffix}`,
    workGroupId,
    workGroupCode,
    categoryId,
    requestedDate,
    status,
    companyName: `架空事業所${suffix}`,
    contactName: `予約担当${suffix}`,
    phoneDisplay: `03-0000-${suffix}0`,
    phoneNormalized: `030000${suffix}0`,
    address: isFluorescent ? undefined : `架空県架空市${number}番地`,
    contactNotes: '',
    categoryAnswers,
    createdAt,
    createdBy: 'demo-system',
    updatedAt: createdAt,
    version: 1,
  }

  if (status === 'confirmed' || status === 'completed') {
    reservation.confirmedAt = minutesBefore(now, 2)
    reservation.confirmedBy = 'demo-system'
    reservation.updatedAt = reservation.confirmedAt
  }
  if (status === 'completed') {
    reservation.completedAt = minutesBefore(now, 1)
    reservation.completedBy = 'demo-system'
    reservation.updatedAt = reservation.completedAt
  }
  if (status === 'cancelled') {
    reservation.cancelledAt = minutesBefore(now, 1)
    reservation.cancelledBy = 'demo-system'
    reservation.cancelReason = 'デモ用の取消例'
    reservation.updatedAt = reservation.cancelledAt
  }
  return reservation
}

function createSeedAuditLogs(reservation: Reservation, now: string): AuditLog[] {
  const isReaccepted = Boolean(reservation.sourceReservationId)
  const logs: AuditLog[] = [{
    auditId: `${reservation.reservationId}-created`,
    entityType: 'reservation',
    entityId: reservation.reservationId,
    action: isReaccepted ? 'reaccepted' : 'created',
    after: { status: reservation.status, requestedDate: reservation.requestedDate },
    actor: 'demo-system',
    occurredAt: reservation.createdAt,
    relatedReservationId: reservation.sourceReservationId,
    note: reservation.overrideType === 'fullCapacity' ? '満枠への例外受付例' : undefined,
  }]
  if (!isReaccepted && (reservation.status === 'confirmed' || reservation.status === 'completed')) {
    logs.push(statusLog(reservation, 'confirmed', reservation.confirmedAt ?? now, 'confirmed'))
  }
  if (reservation.status === 'completed') logs.push(statusLog(reservation, 'completed', reservation.completedAt ?? now))
  if (reservation.status === 'cancelled') logs.push(statusLog(reservation, 'cancelled', reservation.cancelledAt ?? now))
  return logs
}

function statusLog(
  reservation: Reservation,
  action: string,
  now: string,
  status: Reservation['status'] = reservation.status,
): AuditLog {
  return {
    auditId: `${reservation.reservationId}-${action}`,
    entityType: 'reservation',
    entityId: reservation.reservationId,
    action,
    after: { status },
    actor: 'demo-system',
    occurredAt: now,
  }
}

function previousOpenDates(today: string, count: number): string[] {
  const result: string[] = []
  let candidate = addCalendarDays(today, -1)
  while (result.length < count) {
    if (!isSunday(candidate)) result.push(candidate)
    candidate = addCalendarDays(candidate, -1)
  }
  return result
}

function futureOpenDates(start: string, count: number): string[] {
  const result: string[] = []
  let candidate = start
  while (result.length < count) {
    if (!isSunday(candidate)) result.push(candidate)
    candidate = addCalendarDays(candidate, 1)
  }
  return result
}

function minutesBefore(value: string, minutes: number): string {
  return new Date(new Date(value).getTime() - minutes * 60 * 1000).toISOString()
}
