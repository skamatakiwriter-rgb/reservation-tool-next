import type { RegistrationChannel } from './types'

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export type RequestedDateResult =
  | { ok: true; minimumDate: string; maximumDate: string }
  | {
      ok: false
      reason: 'invalidDate' | 'beforeStart' | 'afterEnd' | 'sunday'
      minimumDate: string
      maximumDate: string
    }

export function todayInJapan(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function isValidDateOnly(value: string): boolean {
  if (!DATE_ONLY_PATTERN.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function addCalendarDays(value: string, days: number): string {
  if (!isValidDateOnly(value)) throw new Error('有効な日付を指定してください。')
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return formatUtcDate(date)
}

export function endOfMonthAfter(value: string, months: number): string {
  if (!isValidDateOnly(value)) throw new Error('有効な日付を指定してください。')
  const [year, month] = value.split('-').map(Number)
  return formatUtcDate(new Date(Date.UTC(year, month + months, 0)))
}

export function isSunday(value: string): boolean {
  if (!isValidDateOnly(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() === 0
}

export function registrationWindow(channel: RegistrationChannel, today: string) {
  return {
    minimumDate: channel === 'public' ? addCalendarDays(today, 3) : today,
    maximumDate: endOfMonthAfter(today, 3),
  }
}

export function validateRequestedDate(
  requestedDate: string,
  channel: RegistrationChannel,
  today: string,
): RequestedDateResult {
  const { minimumDate, maximumDate } = registrationWindow(channel, today)
  if (!isValidDateOnly(requestedDate)) return { ok: false, reason: 'invalidDate', minimumDate, maximumDate }
  if (requestedDate < minimumDate) return { ok: false, reason: 'beforeStart', minimumDate, maximumDate }
  if (requestedDate > maximumDate) return { ok: false, reason: 'afterEnd', minimumDate, maximumDate }
  if (isSunday(requestedDate)) return { ok: false, reason: 'sunday', minimumDate, maximumDate }
  return { ok: true, minimumDate, maximumDate }
}

function formatUtcDate(date: Date): string {
  return [
    String(date.getUTCFullYear()).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-')
}
