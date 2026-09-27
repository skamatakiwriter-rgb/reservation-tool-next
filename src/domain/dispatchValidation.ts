import { isSunday, isValidDateOnly } from './dateRules'
import { collectionOutcomes, type CollectionOutcome } from './dispatchTypes'
import type { ValidationError } from './types'

export type DispatchPlanInput = {
  plannedDate: string
  plannedStartTime: string
  plannedEndTime: string
  vehicleId: string
  primaryDriverId: string
  driverInstructions?: string
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

export function validateDispatchPlan(input: DispatchPlanInput): ValidationError[] {
  const errors: ValidationError[] = []
  if (!isValidDateOnly(input.plannedDate) || isSunday(input.plannedDate)) {
    errors.push({ field: 'plannedDate', code: 'invalidDate', message: '予定日は有効な日曜以外の日付にしてください。' })
  }
  if (!TIME_PATTERN.test(input.plannedStartTime) || !TIME_PATTERN.test(input.plannedEndTime)
    || input.plannedStartTime >= input.plannedEndTime) {
    errors.push({ field: 'plannedTime', code: 'invalidTimeRange', message: '開始・終了時刻を正しく入力してください。' })
  }
  if (!input.vehicleId.trim()) errors.push({ field: 'vehicleId', code: 'required', message: '車両を選択してください。' })
  if (!input.primaryDriverId.trim()) errors.push({ field: 'primaryDriverId', code: 'required', message: '担当者を選択してください。' })
  if ((input.driverInstructions?.trim().length ?? 0) > 500) {
    errors.push({ field: 'driverInstructions', code: 'tooLong', message: 'ドライバー指示は500文字以内にしてください。' })
  }
  return errors
}

export function validateDispatchCancelReason(reason: string | undefined): ValidationError[] {
  return (reason?.trim().length ?? 0) > 300
    ? [{ field: 'cancelReason', code: 'tooLong', message: '取消理由は300文字以内にしてください。' }]
    : []
}

export function validateCollectionOutcome(
  outcome: CollectionOutcome,
  actualCollectionSummary?: string,
  outcomeNotes?: string,
): ValidationError[] {
  const errors: ValidationError[] = []
  if (!collectionOutcomes.includes(outcome)) {
    errors.push({ field: 'outcome', code: 'invalidOutcome', message: '作業結果を選択してください。' })
    return errors
  }
  const summary = actualCollectionSummary?.trim() ?? ''
  const notes = outcomeNotes?.trim() ?? ''
  if (summary.length > 500) errors.push({ field: 'actualCollectionSummary', code: 'tooLong', message: '実際の回収内容は500文字以内にしてください。' })
  if (notes.length > 500) errors.push({ field: 'outcomeNotes', code: 'tooLong', message: '結果メモは500文字以内にしてください。' })
  if (outcome === 'partiallyCollected' && !summary) errors.push({ field: 'actualCollectionSummary', code: 'required', message: '実際の回収内容を入力してください。' })
  if ((outcome === 'partiallyCollected' || outcome === 'notCollected') && !notes) {
    errors.push({ field: 'outcomeNotes', code: 'required', message: '結果メモを入力してください。' })
  }
  return errors
}

export function validateVehicleHoldReason(reason: string, consultationNote?: string): ValidationError[] {
  const errors: ValidationError[] = []
  if (!reason.trim() || reason.trim().length > 500) {
    errors.push({ field: 'holdReason', code: 'invalidLength', message: '搬入判断待ちの理由を500文字以内で入力してください。' })
  }
  if ((consultationNote?.trim().length ?? 0) > 500) {
    errors.push({ field: 'consultationNote', code: 'tooLong', message: '相談内容は500文字以内にしてください。' })
  }
  return errors
}
