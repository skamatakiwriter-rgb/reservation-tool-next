import type { CategoryId, DispatchAssignment, Reservation } from '../domain'
import { formatDate } from '../reserve/format'

export function dispatchReviewChanges(reservation: Reservation, assignment: DispatchAssignment): string[] {
  const before = assignment.reservationSnapshotAtLastReview
  const changes: string[] = []
  if (before.requestedDate !== reservation.requestedDate) changes.push(`予約日：${formatDate(before.requestedDate)} → ${formatDate(reservation.requestedDate)}`)
  if ((before.address ?? '') !== (reservation.address ?? '')) changes.push(`回収先：${before.address || 'なし'} → ${reservation.address || 'なし'}`)
  if (JSON.stringify(before.categoryAnswers) !== JSON.stringify(reservation.categoryAnswers)) changes.push(`依頼時申告：${answerSnapshotValue(before.categoryId, before.categoryAnswers)} → ${answerValue(reservation)}`)
  if ((before.contactNotes ?? '') !== (reservation.contactNotes ?? '')) changes.push(`顧客連絡事項：${before.contactNotes || 'なし'} → ${reservation.contactNotes || 'なし'}`)
  return changes.length > 0 ? changes : ['重要項目の変更内容を確認してください。']
}

function answerSnapshotValue(categoryId: CategoryId, answers: Record<string, unknown>) {
  return categoryId === 'keikoukan' ? `おおよそ${String(answers.approximateTubeCount)}本` : String(answers[categoryId === 'kagu' ? 'itemsAndQuantities' : 'typesAndQuantities'])
}

function answerValue(reservation: Reservation) {
  return reservation.categoryId === 'keikoukan' ? `おおよそ${String(reservation.categoryAnswers.approximateTubeCount)}本` : String(reservation.categoryAnswers[reservation.categoryId === 'kagu' ? 'itemsAndQuantities' : 'typesAndQuantities'])
}
