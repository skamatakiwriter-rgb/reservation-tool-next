import { snapshotForDispatch, type CategoryId, type DispatchAssignment, type DispatchReservationSnapshot, type Reservation } from '../domain'
import { formatDate } from '../reserve/format'

export type DispatchReviewFieldKey = 'requestedDate' | 'address' | 'categoryAnswers' | 'contactNotes'

export type DispatchReviewField = {
  key: DispatchReviewFieldKey
  label: string
  before: string
  after: string
  text: string
}

export type DispatchChangeHistoryItem = {
  changeId: string
  changedAt: string
  reservationVersion: number
  fields: DispatchReviewField[]
}

export function dispatchReviewChanges(reservation: Reservation, assignment: DispatchAssignment): string[] {
  const changes = dispatchReviewFields(reservation, assignment).map((change) => change.text)
  return changes.length > 0 ? changes : ['重要項目の変更内容を確認してください。']
}

export function dispatchReviewFields(reservation: Reservation, assignment: DispatchAssignment): DispatchReviewField[] {
  return dispatchSnapshotFields(assignment.reservationSnapshotAtLastReview, snapshotForDispatch(reservation))
}

export function dispatchChangeHistory(reservation: Reservation, assignment: DispatchAssignment): DispatchChangeHistoryItem[] {
  const stored = assignment.reservationChangeHistory ?? []
  const changes = stored.length > 0 || !assignment.needsReview
    ? stored
    : [{
        changeId: `${assignment.dispatchId}-legacy-${reservation.version}`,
        reservationVersion: reservation.version,
        changedAt: reservation.updatedAt,
        before: assignment.reservationSnapshotAtLastReview,
        after: snapshotForDispatch(reservation),
      }]

  return changes
    .map((change) => ({
      changeId: change.changeId,
      changedAt: change.changedAt,
      reservationVersion: change.reservationVersion,
      fields: dispatchSnapshotFields(change.before, change.after),
    }))
    .filter((change) => change.fields.length > 0)
    .reverse()
}

export function dispatchSnapshotFields(before: DispatchReservationSnapshot, after: DispatchReservationSnapshot): DispatchReviewField[] {
  const changes: DispatchReviewField[] = []
  if (before.requestedDate !== after.requestedDate) changes.push(reviewField('requestedDate', '予約日', formatDate(before.requestedDate), formatDate(after.requestedDate)))
  if ((before.address ?? '') !== (after.address ?? '')) changes.push(reviewField('address', '回収先', before.address || 'なし', after.address || 'なし'))
  if (JSON.stringify(before.categoryAnswers) !== JSON.stringify(after.categoryAnswers)) changes.push(reviewField('categoryAnswers', '依頼時申告', answerSnapshotValue(before.categoryId, before.categoryAnswers), answerSnapshotValue(after.categoryId, after.categoryAnswers)))
  if ((before.contactNotes ?? '') !== (after.contactNotes ?? '')) changes.push(reviewField('contactNotes', '顧客連絡事項', before.contactNotes || 'なし', after.contactNotes || 'なし'))
  return changes
}

function reviewField(key: DispatchReviewFieldKey, label: string, before: string, after: string): DispatchReviewField { return { key, label, before, after, text: `${label}：${before} → ${after}` } }

function answerSnapshotValue(categoryId: CategoryId, answers: Record<string, unknown>) {
  return categoryId === 'keikoukan' ? `おおよそ${String(answers.approximateTubeCount)}本` : String(answers[categoryId === 'kagu' ? 'itemsAndQuantities' : 'typesAndQuantities'])
}
