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
  displayName: string
  vehicleType: string
  capacityNote?: string
  usageNotes?: string
  isActive: boolean
  version: number
  loadHold?: VehicleLoadHold
}

export type Driver = {
  driverId: string
  driverCode: string
  displayName: string
  isActive: boolean
  version: number
}

export type DispatchReservationSnapshot = Pick<
  Reservation,
  'requestedDate' | 'categoryId' | 'address' | 'categoryAnswers' | 'contactNotes'
>

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
