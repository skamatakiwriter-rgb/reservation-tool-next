import { addCalendarDays, isSunday } from '../dateRules'
import { snapshotForDispatch, type CollectionOutcome, type DispatchAssignment, type Driver, type InternalNote, type Vehicle } from '../dispatchTypes'
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
    { driverId: 'demo-driver-001', driverCode: 'DRV-DEMO-001', fullName: '架空 太郎', displayName: '収集担当A', notes: '公開デモ用の架空ドライバー', isActive: true, version: 1 },
    { driverId: 'demo-driver-002', driverCode: 'DRV-DEMO-002', fullName: '架空 次郎', displayName: '収集担当B', notes: '公開デモ用の架空ドライバー', isActive: true, version: 1 },
    { driverId: 'demo-driver-003', driverCode: 'DRV-DEMO-003', fullName: '架空 三郎', displayName: '収集担当C', notes: '公開デモ用の架空ドライバー', isActive: true, version: 1 },
  ]
}

export function createSeedData(today: string, now: string, generationId: string): SeedData {
  const [p1, p2] = previousOpenDates(today, 2)
  const [, , p3, p4, p5] = previousOpenDates(today, 5)
  const [, f2, f3, f4] = futureOpenDates(addCalendarDays(today, 3), 4)
  const [v2f1, v2f2, v2f3] = futureOpenDates(addCalendarDays(today, 7), 3)
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
  const reviewBeforeChange = makeReservation(16, v2f3, 'kagu', 'confirmed', now, { itemsAndQuantities: '棚 1台' })
  const reviewReservation: Reservation = {
    ...reviewBeforeChange,
    categoryAnswers: { itemsAndQuantities: '棚 2台' },
    updatedAt: minutesBefore(now, 1),
    version: 2,
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
    makeReservation(10, v2f1, 'kagu', 'confirmed', now, { itemsAndQuantities: '椅子 4脚' }),
    makeReservation(11, v2f2, 'binkan', 'confirmed', now, { typesAndQuantities: '空き缶 2袋' }),
    makeReservation(12, isSunday(today) ? p1 : today, 'binkan', 'confirmed', now, { typesAndQuantities: 'ビン 3箱' }),
    makeReservation(13, p2, 'kagu', 'completed', now, { itemsAndQuantities: '事務机 1台' }),
    makeReservation(14, p3, 'kagu', 'confirmed', now, { itemsAndQuantities: '棚 2台' }),
    makeReservation(15, p4, 'binkan', 'confirmed', now, { typesAndQuantities: 'ビン 3箱、その他の袋 1点' }),
    reviewReservation,
    makeReservation(17, p5, 'kagu', 'completed', now, { itemsAndQuantities: '書庫 1台' }),
  ]

  const byNumber = (number: number) => reservations.find((item) => item.reservationId === `demo-reservation-${String(number).padStart(3, '0')}`)!
  const dispatchAssignments: DispatchAssignment[] = [
    makeDispatch(11, byNumber(11), 'demo-vehicle-001', 'demo-driver-001', now, 'assigned'),
    makeDispatch(12, byNumber(12), 'demo-vehicle-002', 'demo-driver-002', now, 'inProgress'),
    makeDispatch(13, byNumber(13), 'demo-vehicle-001', 'demo-driver-001', now, 'completed', 'allCollected'),
    makeDispatch(14, byNumber(14), 'demo-vehicle-002', 'demo-driver-002', now, 'completed', 'partiallyCollected'),
    makeDispatch(15, byNumber(15), 'demo-vehicle-001', 'demo-driver-001', now, 'completed', 'notCollected'),
    { ...makeDispatch(16, reviewBeforeChange, 'demo-vehicle-001', 'demo-driver-001', now, 'assigned'), needsReview: true },
    makeDispatch(17, byNumber(17), 'demo-vehicle-003', 'demo-driver-003', now, 'completed', 'allCollected'),
  ]
  const vehicles = createVehicleSeed()
  vehicles[2].loadHold = {
    status: 'storedOnVehicle',
    reservationId: byNumber(17).reservationId,
    dispatchId: 'demo-dispatch-017',
    reason: '搬入先の受入状況を確認中',
    consultationNote: '電話で相談し、一時的な積み置きを確認済み',
    startedAt: minutesBefore(now, 1),
    startedBy: 'demo-admin',
  }
  vehicles[2].version = 2
  const internalNotes: InternalNote[] = [
    { noteId: 'demo-note-010', reservationId: byNumber(10).reservationId, body: '電話で回収希望日を確認。量は現地で増減する可能性あり。', createdAt: minutesBefore(now, 2), createdBy: 'demo-admin' },
    { noteId: 'demo-note-014', reservationId: byNumber(14).reservationId, body: '現場で想定より量が多かったため、一部を回収。残りは別日に調整。', createdAt: minutesBefore(now, 1), createdBy: 'demo-admin' },
    { noteId: 'demo-note-015', reservationId: byNumber(15).reservationId, body: '回収不可品の混在を電話で報告。内容を確認して再調整する。', createdAt: minutesBefore(now, 1), createdBy: 'demo-admin' },
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
    vehicles,
    drivers: createDriverSeed(),
    dispatchAssignments,
    internalNotes,
    auditLogs: [
      ...reservations.flatMap((reservation) => createSeedAuditLogs(reservation, now)),
      { auditId: 'demo-reservation-016-updated', entityType: 'reservation', entityId: reviewReservation.reservationId, action: 'updated', before: { version: 1 }, after: { version: 2, dispatchNeedsReview: true }, actor: 'demo-admin', occurredAt: reviewReservation.updatedAt },
      ...dispatchAssignments.map((assignment): AuditLog => ({
        auditId: `${assignment.dispatchId}-seed`,
        entityType: 'dispatch',
        entityId: assignment.dispatchId,
        action: assignment.status === 'completed' ? 'completed' : assignment.status,
        after: { reservationId: assignment.reservationId, status: assignment.status, outcome: assignment.outcome, needsReview: assignment.needsReview },
        actor: 'demo-system',
        occurredAt: assignment.updatedAt,
      })),
      { auditId: 'demo-vehicle-003-hold', entityType: 'vehicle', entityId: 'demo-vehicle-003', action: 'loadHoldConfirmed', after: { status: 'storedOnVehicle', reservationId: byNumber(17).reservationId }, actor: 'demo-system', occurredAt: now },
      ...internalNotes.map((note): AuditLog => ({ auditId: `${note.noteId}-added`, entityType: 'internalNote', entityId: note.noteId, action: 'added', after: { reservationId: note.reservationId }, actor: note.createdBy, occurredAt: note.createdAt })),
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

function makeDispatch(
  number: number,
  reservation: Reservation,
  vehicleId: string,
  primaryDriverId: string,
  now: string,
  status: DispatchAssignment['status'],
  outcome?: CollectionOutcome,
): DispatchAssignment {
  const suffix = String(number).padStart(3, '0')
  const snapshot = snapshotForDispatch(reservation)
  const assignment: DispatchAssignment = {
    dispatchId: `demo-dispatch-${suffix}`,
    reservationId: reservation.reservationId,
    attemptNumber: 1,
    plannedDate: reservation.requestedDate,
    plannedStartTime: '09:00',
    plannedEndTime: '10:00',
    vehicleId,
    primaryDriverId,
    status,
    reservationVersionAtAssignment: reservation.version,
    reservationSnapshotAtAssignment: snapshot,
    reservationVersionAtLastReview: reservation.version,
    reservationSnapshotAtLastReview: structuredClone(snapshot),
    needsReview: false,
    driverInstructions: '現場到着前に配車担当へ電話で確認',
    createdAt: minutesBefore(now, 3),
    createdBy: 'demo-admin',
    updatedAt: minutesBefore(now, 2),
    updatedBy: 'demo-admin',
    version: 1,
  }
  if (status === 'inProgress') {
    assignment.startedAt = minutesBefore(now, 1)
    assignment.startedBy = `demo-driver:${primaryDriverId}`
    assignment.updatedAt = assignment.startedAt
    assignment.updatedBy = assignment.startedBy
    assignment.version = 2
  }
  if (status === 'completed') {
    assignment.completedAt = minutesBefore(now, 1)
    assignment.completedBy = `demo-driver:${primaryDriverId}`
    assignment.updatedAt = assignment.completedAt
    assignment.updatedBy = assignment.completedBy
    assignment.outcome = outcome
    assignment.version = 2
    if (outcome === 'allCollected' || outcome === 'partiallyCollected') {
      assignment.actualCollectionSummary = outcome === 'allCollected' ? '申告分を全量回収' : '一部を回収し、残量あり'
    }
    if (outcome === 'partiallyCollected') assignment.outcomeNotes = '想定より量が多く、残量を別日に調整'
    if (outcome === 'notCollected') assignment.outcomeNotes = '回収不可品が含まれていたため持ち帰りなし'
  }
  return assignment
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
