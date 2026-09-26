import { categoryRequiresDispatch } from './categories'
import type { CollectionOutcome, DispatchAssignment, DispatchStatus, Vehicle } from './dispatchTypes'
import type { Reservation } from './types'

export type DispatchDisplayState =
  | 'reservationCancelled'
  | 'beforeDispatch'
  | 'notDispatchable'
  | 'legacyCompleted'
  | 'unassigned'
  | 'assigned'
  | 'inProgress'
  | 'needsRedispatch'
  | 'needsAttention'
  | 'allCollected'
  | 'dataError'

const allowedDispatchTransitions: Readonly<Record<DispatchStatus, readonly DispatchStatus[]>> = {
  assigned: ['inProgress', 'completed', 'cancelled'],
  inProgress: ['completed'],
  completed: [],
  cancelled: [],
}

export function canTransitionDispatch(from: DispatchStatus, to: DispatchStatus): boolean {
  return allowedDispatchTransitions[from].includes(to)
}

export function isVehicleAvailableForDispatch(vehicle: Vehicle): boolean {
  return vehicle.isActive && vehicle.loadHold === undefined
}

export function timeRangesOverlap(
  first: Pick<DispatchAssignment, 'plannedDate' | 'plannedStartTime' | 'plannedEndTime'>,
  second: Pick<DispatchAssignment, 'plannedDate' | 'plannedStartTime' | 'plannedEndTime'>,
): boolean {
  return first.plannedDate === second.plannedDate
    && first.plannedStartTime < second.plannedEndTime
    && second.plannedStartTime < first.plannedEndTime
}

export function requiredOutcomeFields(outcome: CollectionOutcome): ReadonlyArray<'actualCollectionSummary' | 'outcomeNotes'> {
  if (outcome === 'partiallyCollected') return ['actualCollectionSummary', 'outcomeNotes']
  if (outcome === 'notCollected') return ['outcomeNotes']
  return []
}

export function dispatchDisplayState(
  reservation: Reservation,
  assignments: readonly DispatchAssignment[],
): { state: DispatchDisplayState; needsReview: boolean } {
  if (reservation.status === 'cancelled') return { state: 'reservationCancelled', needsReview: false }
  if (reservation.status === 'received') return { state: 'beforeDispatch', needsReview: false }
  if (!categoryRequiresDispatch(reservation.categoryId)) return { state: 'notDispatchable', needsReview: false }
  if (reservation.status === 'completed' && assignments.length === 0) {
    return { state: 'legacyCompleted', needsReview: false }
  }

  const active = assignments.filter((item) => item.status === 'assigned' || item.status === 'inProgress')
  if (active.length > 1) return { state: 'dataError', needsReview: false }
  if (active.length === 1) {
    if (reservation.status !== 'confirmed') return { state: 'dataError', needsReview: false }
    return { state: active[0].status === 'assigned' ? 'assigned' : 'inProgress', needsReview: active[0].needsReview }
  }

  const latestCompleted = assignments
    .filter((item) => item.status === 'completed')
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '') || b.attemptNumber - a.attemptNumber)[0]

  if (!latestCompleted) return { state: reservation.status === 'confirmed' ? 'unassigned' : 'dataError', needsReview: false }
  if (latestCompleted.outcome === 'partiallyCollected') return { state: 'needsRedispatch', needsReview: false }
  if (latestCompleted.outcome === 'notCollected') return { state: 'needsAttention', needsReview: false }
  if (latestCompleted.outcome === 'allCollected') return { state: 'allCollected', needsReview: false }
  return { state: 'dataError', needsReview: false }
}
