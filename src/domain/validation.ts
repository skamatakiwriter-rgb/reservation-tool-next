import { categoryRequiresAddress } from './categories'
import { validateRequestedDate } from './dateRules'
import type { RegistrationChannel, ReservationInput, ValidationError } from './types'

const PHONE_SEPARATORS = /[\s\u3000\-－‐‑‒–—―ー]/g

export function normalizePhoneNumber(value: string): string {
  return value
    .replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - '０'.charCodeAt(0)))
    .replace(PHONE_SEPARATORS, '')
}

export function validateReservationInput(
  input: ReservationInput,
  context: { channel: RegistrationChannel; today: string },
): ValidationError[] {
  const errors: ValidationError[] = []
  validateRequiredLength(errors, 'companyName', input.companyName, 100, '会社名')
  validateRequiredLength(errors, 'contactName', input.contactName, 50, '担当者名')

  const normalizedPhone = normalizePhoneNumber(input.phone)
  if (!/^\d{10,11}$/.test(normalizedPhone)) {
    errors.push({ field: 'phone', code: 'invalidPhone', message: '電話番号は10桁または11桁で入力してください。' })
  }

  if (categoryRequiresAddress(input.categoryId)) {
    validateRequiredLength(errors, 'address', input.address ?? '', 200, '住所')
  }

  if ((input.contactNotes ?? '').length > 500) {
    errors.push({ field: 'contactNotes', code: 'tooLong', message: '連絡事項は500文字以内で入力してください。' })
  }

  validateCategoryAnswers(input, errors)

  const dateResult = validateRequestedDate(input.requestedDate, context.channel, context.today)
  if (!dateResult.ok) {
    const messages = {
      invalidDate: '希望日を正しい日付で入力してください。',
      beforeStart: `希望日は${dateResult.minimumDate}以降を選んでください。`,
      afterEnd: `希望日は${dateResult.maximumDate}以前を選んでください。`,
      sunday: '日曜日は選べません。',
    }
    errors.push({ field: 'requestedDate', code: dateResult.reason, message: messages[dateResult.reason] })
  }

  if (context.channel === 'public' && input.demoNoticeAccepted !== true) {
    errors.push({ field: 'demoNoticeAccepted', code: 'required', message: '公開デモの注意事項を確認してください。' })
  }

  return errors
}

function validateRequiredLength(
  errors: ValidationError[],
  field: string,
  value: string,
  maximum: number,
  label: string,
) {
  const length = value.trim().length
  if (length === 0) {
    errors.push({ field, code: 'required', message: `${label}を入力してください。` })
  } else if (length > maximum) {
    errors.push({ field, code: 'tooLong', message: `${label}は${maximum}文字以内で入力してください。` })
  }
}

function validateCategoryAnswers(input: ReservationInput, errors: ValidationError[]) {
  if (input.categoryId === 'keikoukan') {
    const count = input.categoryAnswers.approximateTubeCount
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 9999) {
      errors.push({ field: 'approximateTubeCount', code: 'invalidCount', message: '蛍光管の概算本数は1～9999の整数で入力してください。' })
    }
    return
  }

  const field = input.categoryId === 'kagu' ? 'itemsAndQuantities' : 'typesAndQuantities'
  const label = input.categoryId === 'kagu' ? '品目と数量' : '種類と数量'
  const value = input.categoryAnswers[field]
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push({ field, code: 'required', message: `${label}を入力してください。` })
  } else if (value.trim().length > 300) {
    errors.push({ field, code: 'tooLong', message: `${label}は300文字以内で入力してください。` })
  }
}
