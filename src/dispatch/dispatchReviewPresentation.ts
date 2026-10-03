import type { CategoryId, DispatchAssignment, Reservation } from '../domain'
import { formatDate } from '../reserve/format'

export type DispatchReviewFieldKey = 'requestedDate' | 'address' | 'categoryAnswers' | 'contactNotes'

export type DispatchReviewField = {
  key: DispatchReviewFieldKey
  label: string
  before: string
  after: string
  text: string
}

export function dispatchReviewChanges(reservation: Reservation, assignment: DispatchAssignment): string[] {
  const changes = dispatchReviewFields(reservation, assignment).map((change) => change.text)
  return changes.length > 0 ? changes : ['重要項目の変更内容を確認してください。']
}

export function dispatchReviewFields(reservation: Reservation, assignment: DispatchAssignment): DispatchReviewField[] {
  const before = assignment.reservationSnapshotAtLastReview
  const changes: DispatchReviewField[] = []
  if (before.requestedDate !== reservation.requestedDate) changes.push(reviewField('requestedDate', '予約日', formatDate(before.requestedDate), formatDate(reservation.requestedDate)))
  if ((before.address ?? '') !== (reservation.address ?? '')) changes.push(reviewField('address', '回収先', before.address || 'なし', reservation.address || 'なし'))
  if (JSON.stringify(before.categoryAnswers) !== JSON.stringify(reservation.categoryAnswers)) changes.push(reviewField('categoryAnswers', '依頼時申告', answerSnapshotValue(before.categoryId, before.categoryAnswers), answerValue(reservation)))
  if ((before.contactNotes ?? '') !== (reservation.contactNotes ?? '')) changes.push(reviewField('contactNotes', '顧客連絡事項', before.contactNotes || 'なし', reservation.contactNotes || 'なし'))
  return changes
}

function reviewField(key: DispatchReviewFieldKey, label: string, before: string, after: string): DispatchReviewField { return { key, label, before, after, text: `${label}：${before} → ${after}` } }

function answerSnapshotValue(categoryId: CategoryId, answers: Record<string, unknown>) {
  return categoryId === 'keikoukan' ? `おおよそ${String(answers.approximateTubeCount)}本` : String(answers[categoryId === 'kagu' ? 'itemsAndQuantities' : 'typesAndQuantities'])
}

function answerValue(reservation: Reservation) {
  return reservation.categoryId === 'keikoukan' ? `おおよそ${String(reservation.categoryAnswers.approximateTubeCount)}本` : String(reservation.categoryAnswers[reservation.categoryId === 'kagu' ? 'itemsAndQuantities' : 'typesAndQuantities'])
}
