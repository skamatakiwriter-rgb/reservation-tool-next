import { describe, expect, it } from 'vitest'
import {
  canUseFullCapacityOverride,
  countReservationsForCapacity,
  evaluateAvailability,
} from './availability'
import type { ReservationForCapacity } from './types'

const reservations: ReservationForCapacity[] = [
  { reservationId: 'R1', requestedDate: '2026-09-17', categoryId: 'kagu', status: 'received' },
  { reservationId: 'R2', requestedDate: '2026-09-17', categoryId: 'kagu', status: 'confirmed' },
  { reservationId: 'R3', requestedDate: '2026-09-17', categoryId: 'kagu', status: 'cancelled' },
  { reservationId: 'R4', requestedDate: '2026-09-17', categoryId: 'binkan', status: 'completed' },
]

function evaluate(overrides: Partial<Parameters<typeof evaluateAvailability>[0]> = {}) {
  return evaluateAvailability({
    requestedDate: '2026-09-17',
    categoryId: 'kagu',
    channel: 'public',
    today: '2026-09-14',
    setting: { categoryId: 'kagu', dailyLimit: 3 },
    isClosed: false,
    reservations,
    ...overrides,
  })
}

describe('日別件数', () => {
  it('受付・確定・完了を数え、取消を除く', () => {
    expect(countReservationsForCapacity(reservations, '2026-09-17', 'kagu')).toBe(2)
    expect(countReservationsForCapacity(reservations, '2026-09-17', 'binkan')).toBe(1)
  })

  it('数量ではなく予約1件を1枠として数える', () => {
    expect(countReservationsForCapacity(reservations, '2026-09-17', 'kagu')).toBe(2)
  })

  it('日付変更時は対象予約自身を除外できる', () => {
    expect(countReservationsForCapacity(reservations, '2026-09-17', 'kagu', 'R1')).toBe(1)
  })
})

describe('受付可否', () => {
  it('空きがあれば残数を返す', () => {
    expect(evaluate()).toEqual({ available: true, currentCount: 2, dailyLimit: 3, remaining: 1 })
  })

  it('上限0を無制限にせず受付停止にする', () => {
    expect(evaluate({ setting: { categoryId: 'kagu', dailyLimit: 0 } })).toMatchObject({ available: false, reason: 'zeroLimit' })
  })

  it('正整数上限に達したら満枠にする', () => {
    expect(evaluate({ setting: { categoryId: 'kagu', dailyLimit: 2 } })).toMatchObject({ available: false, reason: 'full' })
  })

  it('手動停止は空きがあっても優先する', () => {
    expect(evaluate({ isClosed: true })).toMatchObject({ available: false, reason: 'closed' })
  })

  it.each([-1, 1.5, '2', undefined])('不正な上限 %s を設定エラーにする', (dailyLimit) => {
    expect(evaluate({ setting: dailyLimit === undefined ? undefined : { categoryId: 'kagu', dailyLimit } })).toMatchObject({ available: false, reason: 'invalidSetting' })
  })

  it('満枠だけ管理者の明示確認で例外受付できる', () => {
    const full = evaluate({ setting: { categoryId: 'kagu', dailyLimit: 2 } })
    const closed = evaluate({ isClosed: true })
    expect(canUseFullCapacityOverride(full, false)).toBe(false)
    expect(canUseFullCapacityOverride(full, true)).toBe(true)
    expect(canUseFullCapacityOverride(closed, true)).toBe(false)
  })
})
