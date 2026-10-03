import { describe, expect, it } from 'vitest'
import { createSeedData } from '../domain/storage/seed'
import { dispatchChangeHistory } from './dispatchReviewPresentation'

describe('配車後の変更履歴表示', () => {
  it('管理者の確認後も保存済みの変更履歴を表示対象にする', () => {
    const seed = createSeedData('2026-09-27', '2026-09-27T01:00:00.000Z', 'test-generation')
    const reservation = seed.reservations.find((item) => item.reservationId === 'demo-reservation-016')!
    const assignment = seed.dispatchAssignments.find((item) => item.reservationId === reservation.reservationId)!

    const history = dispatchChangeHistory(reservation, { ...assignment, needsReview: false })

    expect(history).toHaveLength(1)
    expect(history[0].fields).toEqual([expect.objectContaining({ key: 'categoryAnswers', before: '棚 1台', after: '棚 2台' })])
  })

  it('複数回の変更は新しい順に返す', () => {
    const seed = createSeedData('2026-09-27', '2026-09-27T01:00:00.000Z', 'test-generation')
    const reservation = seed.reservations.find((item) => item.reservationId === 'demo-reservation-016')!
    const assignment = seed.dispatchAssignments.find((item) => item.reservationId === reservation.reservationId)!
    const first = assignment.reservationChangeHistory![0]
    const second = { ...first, changeId: 'second', reservationVersion: 3, changedAt: '2026-09-27T02:00:00.000Z', before: first.after, after: { ...first.after, categoryAnswers: { itemsAndQuantities: '棚 3台' } } }

    const history = dispatchChangeHistory(reservation, { ...assignment, reservationChangeHistory: [first, second] })

    expect(history.map((item) => item.reservationVersion)).toEqual([3, 2])
    expect(history[0].fields[0]).toMatchObject({ before: '棚 2台', after: '棚 3台' })
  })
})
