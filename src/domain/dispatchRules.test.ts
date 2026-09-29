import { describe, expect, it } from 'vitest'
import { categoryRequiresDispatch } from './categories'
import { canTransitionDispatch, dispatchDeadlineTiming, dispatchDisplayState, isVehicleAvailableForDispatch, requiredOutcomeFields, timeRangesOverlap } from './dispatchRules'
import type { DispatchAssignment, Vehicle } from './dispatchTypes'
import type { Reservation } from './types'

const reservation = { reservationId: 'r1', categoryId: 'kagu', status: 'confirmed' } as Reservation
const assignment = {
  dispatchId: 'd1', reservationId: 'r1', attemptNumber: 1, status: 'assigned', needsReview: false,
  plannedDate: '2026-09-28', plannedStartTime: '09:00', plannedEndTime: '10:00',
} as DispatchAssignment

describe('Ver2の純粋な配車規則', () => {
  it('持込は配車不要、回収カテゴリーは配車対象', () => {
    expect(categoryRequiresDispatch('keikoukan')).toBe(false)
    expect(categoryRequiresDispatch('kagu')).toBe(true)
    expect(categoryRequiresDispatch('binkan')).toBe(true)
  })

  it('開始記録なしの終了と任意の開始記録を許す', () => {
    expect(canTransitionDispatch('assigned', 'completed')).toBe(true)
    expect(canTransitionDispatch('assigned', 'inProgress')).toBe(true)
    expect(canTransitionDispatch('inProgress', 'completed')).toBe(true)
    expect(canTransitionDispatch('inProgress', 'cancelled')).toBe(false)
    expect(canTransitionDispatch('completed', 'assigned')).toBe(false)
  })

  it('隣接時刻は重複しない', () => {
    expect(timeRangesOverlap(assignment, { ...assignment, plannedStartTime: '10:00', plannedEndTime: '11:00' })).toBe(false)
    expect(timeRangesOverlap(assignment, { ...assignment, plannedStartTime: '09:30', plannedEndTime: '10:30' })).toBe(true)
    expect(timeRangesOverlap(assignment, { ...assignment, plannedDate: '2026-09-29' })).toBe(false)
  })

  it('搬入判断待ち・積み置き中は車両を選べない', () => {
    const vehicle = { isActive: true } as Vehicle
    expect(isVehicleAvailableForDispatch(vehicle)).toBe(true)
    expect(isVehicleAvailableForDispatch({ ...vehicle, loadHold: { status: 'decisionPending' } as Vehicle['loadHold'] })).toBe(false)
    expect(isVehicleAvailableForDispatch({ ...vehicle, loadHold: { status: 'storedOnVehicle' } as Vehicle['loadHold'] })).toBe(false)
  })

  it('作業結果の必須入力を分ける', () => {
    expect(requiredOutcomeFields('allCollected')).toEqual([])
    expect(requiredOutcomeFields('partiallyCollected')).toEqual(['actualCollectionSummary', 'outcomeNotes'])
    expect(requiredOutcomeFields('notCollected')).toEqual(['outcomeNotes'])
  })

  it('未配車の期限警告を今日・明日・2日後に分ける', () => {
    expect(dispatchDeadlineTiming('2026-09-28', '2026-09-28')).toBe('today')
    expect(dispatchDeadlineTiming('2026-09-29', '2026-09-28')).toBe('tomorrow')
    expect(dispatchDeadlineTiming('2026-09-30', '2026-09-28')).toBe('twoDays')
    expect(dispatchDeadlineTiming('2026-10-01', '2026-09-28')).toBeUndefined()
    expect(dispatchDeadlineTiming('2026-09-27', '2026-09-28')).toBeUndefined()
  })

  it('予約と配車の状態を分けて表示する', () => {
    expect(dispatchDisplayState(reservation, []).state).toBe('unassigned')
    expect(dispatchDisplayState(reservation, [assignment])).toEqual({ state: 'assigned', needsReview: false })
    expect(dispatchDisplayState(reservation, [{ ...assignment, needsReview: true }])).toEqual({ state: 'assigned', needsReview: true })
    expect(dispatchDisplayState({ ...reservation, status: 'cancelled' }, [assignment]).state).toBe('reservationCancelled')
  })

  it('一部回収後に後続配車だけ取り消しても要再配車へ戻る', () => {
    const completed = { ...assignment, status: 'completed', outcome: 'partiallyCollected', completedAt: '2026-09-28T01:00:00Z' } as DispatchAssignment
    const cancelled = { ...assignment, dispatchId: 'd2', attemptNumber: 2, status: 'cancelled' } as DispatchAssignment
    expect(dispatchDisplayState(reservation, [completed, cancelled]).state).toBe('needsRedispatch')
  })

  it('有効配車の二重登録はデータエラーとする', () => {
    expect(dispatchDisplayState(reservation, [assignment, { ...assignment, dispatchId: 'd2' }]).state).toBe('dataError')
  })
})
