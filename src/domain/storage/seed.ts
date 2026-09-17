import { addCalendarDays, isSunday } from '../dateRules'
import type { AuditLog, CategoryId, CategorySetting, Closure, DemoMetadata, Reservation } from '../types'
import { SCHEMA_VERSION, SEED_VERSION } from './schema'

export type SeedData = {
  metadata: DemoMetadata
  reservations: Reservation[]
  settings: CategorySetting[]
  closures: Closure[]
  auditLogs: AuditLog[]
}

export function createSeedData(today: string, now: string, generationId: string): SeedData {
  const [p1, p2] = previousOpenDates(today, 2)
  const [, f2, f3, f4] = futureOpenDates(addCalendarDays(today, 3), 4)
  const sharedGroupId = 'demo-work-group-006'
  const sharedGroupCode = 'GROUP-DEMO-006'

  const reservations: Reservation[] = [
    makeReservation(1, p2, 'keikoukan', 'completed', now, { approximateTubeCount: 24 }),
    makeReservation(2, p1, 'kagu', 'cancelled', now, { itemsAndQuantities: '事務机 1台、椅子 2脚' }),
    makeReservation(3, f2, 'binkan', 'received', now, { typesAndQuantities: '空き缶 3袋' }),
    makeReservation(4, f2, 'binkan', 'received', now, { typesAndQuantities: 'ビン 2箱' }),
    makeReservation(5, f3, 'kagu', 'confirmed', now, { itemsAndQuantities: '書庫 1台' }),
    makeReservation(6, f4, 'keikoukan', 'confirmed', now, { approximateTubeCount: 30 }, sharedGroupId, sharedGroupCode),
    makeReservation(7, f4, 'keikoukan', 'confirmed', now, { approximateTubeCount: 18 }, sharedGroupId, sharedGroupCode),
    { ...makeReservation(8, f4, 'keikoukan', 'confirmed', now, { approximateTubeCount: 12 }, sharedGroupId, sharedGroupCode), overrideType: 'fullCapacity' },
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
    auditLogs: reservations.flatMap((reservation) => createSeedAuditLogs(reservation, now)),
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
    createdAt: now,
    createdBy: 'demo-system',
    updatedAt: now,
    version: 1,
  }

  if (status === 'confirmed' || status === 'completed') {
    reservation.confirmedAt = now
    reservation.confirmedBy = 'demo-system'
  }
  if (status === 'completed') {
    reservation.completedAt = now
    reservation.completedBy = 'demo-system'
  }
  if (status === 'cancelled') {
    reservation.cancelledAt = now
    reservation.cancelledBy = 'demo-system'
    reservation.cancelReason = 'デモ用の取消例'
  }
  return reservation
}

function createSeedAuditLogs(reservation: Reservation, now: string): AuditLog[] {
  const logs: AuditLog[] = [{
    auditId: `${reservation.reservationId}-created`,
    entityType: 'reservation',
    entityId: reservation.reservationId,
    action: 'created',
    after: { status: reservation.status, requestedDate: reservation.requestedDate },
    actor: 'demo-system',
    occurredAt: now,
    note: reservation.overrideType === 'fullCapacity' ? '満枠への例外受付例' : undefined,
  }]
  if (reservation.status === 'confirmed' || reservation.status === 'completed') {
    logs.push(statusLog(reservation, 'confirmed', now, 'confirmed'))
  }
  if (reservation.status === 'completed') logs.push(statusLog(reservation, 'completed', now))
  if (reservation.status === 'cancelled') logs.push(statusLog(reservation, 'cancelled', now))
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
