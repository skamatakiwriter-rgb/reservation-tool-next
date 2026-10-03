import type { Actor, Reservation } from './types'

export const dispatchStatuses = ['assigned', 'inProgress', 'completed', 'cancelled'] as const
export type DispatchStatus = (typeof dispatchStatuses)[number]

export const collectionOutcomes = ['allCollected', 'partiallyCollected', 'notCollected'] as const
export type CollectionOutcome = (typeof collectionOutcomes)[number]

export type VehicleLoadHold = {
  status: 'decisionPending' | 'storedOnVehicle'
  reservationId: string
  dispatchId: string
  reason: string
  consultationNote: string
  startedAt: string
  startedBy: Actor
}

export type Vehicle = {
  vehicleId: string
  vehicleCode: string
  registrationNumber?: string
  /** 旧データ読込用。新規登録・画面表示ではregistrationNumberを使用する。 */
  displayName?: string
  vehicleType: string
  capacityNote?: string
  usageNotes?: string
  isActive: boolean
  updatedAt?: string
  updatedBy?: Actor
  version: number
  loadHold?: VehicleLoadHold
}

export function vehicleName(vehicle: Vehicle | undefined): string {
  return vehicle?.registrationNumber?.trim() || vehicle?.displayName?.trim() || '車両不明'
}

export type Driver = {
  driverId: string
  driverCode: string
  fullName?: string
  /** 旧データ読込用。新規登録・画面表示ではfullNameを使用する。 */
  displayName?: string
  notes?: string
  isActive: boolean
  updatedAt?: string
  updatedBy?: Actor
  version: number
}

export function driverName(driver: Driver | undefined): string {
  return driver?.fullName?.trim() || driver?.displayName?.trim() || '担当者不明'
}

export type DispatchReservationSnapshot = Pick<
  Reservation,
  'requestedDate' | 'categoryId' | 'address' | 'categoryAnswers' | 'contactNotes'
>

export type DispatchReservationChange = {
  changeId: string
  reservationVersion: number
  changedAt: string
  before: DispatchReservationSnapshot
  after: DispatchReservationSnapshot
}

export type DispatchAssignment = {
  dispatchId: string
  reservationId: string
  attemptNumber: number
  plannedDate: string
  plannedStartTime: string
  plannedEndTime: string
  vehicleId: string
  primaryDriverId: string
  status: DispatchStatus
  reservationVersionAtAssignment: number
  reservationSnapshotAtAssignment: DispatchReservationSnapshot
  reservationVersionAtLastReview: number
  reservationSnapshotAtLastReview: DispatchReservationSnapshot
  /** 配車後の重要変更。旧DBレコードとの互換性のため任意項目として扱う。 */
  reservationChangeHistory?: DispatchReservationChange[]
  needsReview: boolean
  driverInstructions?: string
  startedAt?: string
  startedBy?: Actor
  completedAt?: string
  completedBy?: Actor
  outcome?: CollectionOutcome
  actualCollectionSummary?: string
  outcomeNotes?: string
  cancelledAt?: string
  cancelledBy?: Actor
  cancelReason?: string
  createdAt: string
  createdBy: Actor
  updatedAt: string
  updatedBy: Actor
  version: number
}

export type InternalNote = {
  noteId: string
  reservationId: string
  body: string
  createdAt: string
  createdBy: Actor
}

export function snapshotForDispatch(reservation: Reservation): DispatchReservationSnapshot {
  return {
    requestedDate: reservation.requestedDate,
    categoryId: reservation.categoryId,
    address: reservation.address,
    categoryAnswers: structuredClone(reservation.categoryAnswers),
    contactNotes: reservation.contactNotes,
  }
}
