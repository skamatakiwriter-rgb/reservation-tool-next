import type { CategoryId, ReservationStatus } from './types'

const allowedTransitions: Readonly<Record<ReservationStatus, readonly ReservationStatus[]>> = {
  received: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
}

export function initialStatus(
  categoryId: CategoryId,
  channel: 'public' | 'admin',
  detailsConfirmed = false,
): ReservationStatus {
  if (categoryId === 'keikoukan') return 'confirmed'
  if (channel === 'admin' && detailsConfirmed) return 'confirmed'
  return 'received'
}

export function canTransition(from: ReservationStatus, to: ReservationStatus): boolean {
  return allowedTransitions[from].includes(to)
}

export function availableTransitions(status: ReservationStatus): readonly ReservationStatus[] {
  return allowedTransitions[status]
}
