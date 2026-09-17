import { validateRequestedDate } from './dateRules'
import type {
  CategoryId,
  CategorySetting,
  RegistrationChannel,
  ReservationForCapacity,
} from './types'

const countedStatuses = new Set(['received', 'confirmed', 'completed'])

export type AvailabilityResult =
  | { available: true; currentCount: number; dailyLimit: number; remaining: number }
  | {
      available: false
      reason: 'invalidDate' | 'beforeStart' | 'afterEnd' | 'sunday' | 'invalidSetting' | 'closed' | 'zeroLimit' | 'full'
      currentCount: number
      dailyLimit: number | null
      remaining: number
    }

type AvailabilityInput = {
  requestedDate: string
  categoryId: CategoryId
  channel: RegistrationChannel
  today: string
  setting: CategorySetting | undefined
  isClosed: boolean
  reservations: readonly ReservationForCapacity[]
  excludeReservationId?: string
}

export function countReservationsForCapacity(
  reservations: readonly ReservationForCapacity[],
  requestedDate: string,
  categoryId: CategoryId,
  excludeReservationId?: string,
): number {
  return reservations.filter((reservation) =>
    reservation.reservationId !== excludeReservationId
    && reservation.requestedDate === requestedDate
    && reservation.categoryId === categoryId
    && countedStatuses.has(reservation.status),
  ).length
}

export function evaluateAvailability(input: AvailabilityInput): AvailabilityResult {
  const currentCount = countReservationsForCapacity(
    input.reservations,
    input.requestedDate,
    input.categoryId,
    input.excludeReservationId,
  )
  const dateResult = validateRequestedDate(input.requestedDate, input.channel, input.today)
  if (!dateResult.ok) {
    return { available: false, reason: dateResult.reason, currentCount, dailyLimit: null, remaining: 0 }
  }

  if (!input.setting || input.setting.categoryId !== input.categoryId || !isDailyLimit(input.setting.dailyLimit)) {
    return { available: false, reason: 'invalidSetting', currentCount, dailyLimit: null, remaining: 0 }
  }

  const dailyLimit = input.setting.dailyLimit
  if (input.isClosed) return { available: false, reason: 'closed', currentCount, dailyLimit, remaining: 0 }
  if (dailyLimit === 0) return { available: false, reason: 'zeroLimit', currentCount, dailyLimit, remaining: 0 }
  if (currentCount >= dailyLimit) return { available: false, reason: 'full', currentCount, dailyLimit, remaining: 0 }

  return { available: true, currentCount, dailyLimit, remaining: dailyLimit - currentCount }
}

export function isDailyLimit(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

export function canUseFullCapacityOverride(result: AvailabilityResult, acknowledged: boolean): boolean {
  return !result.available && result.reason === 'full' && acknowledged
}
