import { isSunday, isValidDateOnly } from './dateRules'
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
