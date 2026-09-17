import { describe, expect, it } from 'vitest'
import type { ReservationInput } from './types'
import { normalizePhoneNumber, validateReservationInput } from './validation'

const baseInput: ReservationInput = {
  categoryId: 'kagu',
  requestedDate: '2026-09-17',
  companyName: '架空商事株式会社',
  contactName: '予約担当',
  phone: '０３－１２３４－５６７８',
  address: '架空県架空市1-2-3',
  contactNotes: '',
  categoryAnswers: { itemsAndQuantities: '机 2台' },
  demoNoticeAccepted: true,
}

function validate(overrides: Partial<ReservationInput> = {}, channel: 'public' | 'admin' = 'public') {
  return validateReservationInput({ ...baseInput, ...overrides }, { channel, today: '2026-09-14' })
}

describe('電話番号の正規化', () => {
  it('全角数字、空白、ハイフンを正規化する', () => {
    expect(normalizePhoneNumber('０３－１２３４ ー ５６７８')).toBe('0312345678')
  })

  it('文字は削除せず検証で拒否できるようにする', () => {
    expect(normalizePhoneNumber('03-ABCD-5678')).toBe('03ABCD5678')
  })
})

describe('共通入力検証', () => {
  it('正しい家具家財申込みを受け付ける', () => {
    expect(validate()).toEqual([])
  })

  it('会社名と担当者名の空欄を項目別に返す', () => {
    const fields = validate({ companyName: ' ', contactName: '' }).map((error) => error.field)
    expect(fields).toEqual(expect.arrayContaining(['companyName', 'contactName']))
  })

  it.each(['123456789', '123456789012', '03-ABCD-5678'])('不正な電話番号 %s を拒否する', (phone) => {
    expect(validate({ phone })).toContainEqual(expect.objectContaining({ field: 'phone', code: 'invalidPhone' }))
  })

  it('家具家財とビン缶では住所を必須にする', () => {
    expect(validate({ address: '' })).toContainEqual(expect.objectContaining({ field: 'address', code: 'required' }))
    expect(validate({ categoryId: 'binkan', address: '', categoryAnswers: { typesAndQuantities: '缶 1袋' } })).toContainEqual(expect.objectContaining({ field: 'address' }))
  })

  it('蛍光管では住所を要求しない', () => {
    expect(validate({ categoryId: 'keikoukan', address: undefined, categoryAnswers: { approximateTubeCount: 10 } })).toEqual([])
  })

  it.each([0, -1, 1.5, 10000, '10'])('蛍光管の不正な本数 %s を拒否する', (count) => {
    expect(validate({ categoryId: 'keikoukan', address: undefined, categoryAnswers: { approximateTubeCount: count } })).toContainEqual(expect.objectContaining({ field: 'approximateTubeCount' }))
  })

  it('カテゴリー固有内容は300文字まで', () => {
    expect(validate({ categoryAnswers: { itemsAndQuantities: 'あ'.repeat(300) } })).toEqual([])
    expect(validate({ categoryAnswers: { itemsAndQuantities: 'あ'.repeat(301) } })).toContainEqual(expect.objectContaining({ field: 'itemsAndQuantities', code: 'tooLong' }))
  })

  it('連絡事項は500文字まで', () => {
    expect(validate({ contactNotes: 'あ'.repeat(500) })).toEqual([])
    expect(validate({ contactNotes: 'あ'.repeat(501) })).toContainEqual(expect.objectContaining({ field: 'contactNotes', code: 'tooLong' }))
  })

  it('公開画面だけデモ注意確認を必須にする', () => {
    expect(validate({ demoNoticeAccepted: false })).toContainEqual(expect.objectContaining({ field: 'demoNoticeAccepted' }))
    expect(validate({ demoNoticeAccepted: false }, 'admin')).toEqual([])
  })

  it('利用者と管理者で開始日だけを切り替える', () => {
    expect(validate({ requestedDate: '2026-09-14' })).toContainEqual(expect.objectContaining({ field: 'requestedDate', code: 'beforeStart' }))
    expect(validate({ requestedDate: '2026-09-14' }, 'admin')).toEqual([])
  })
})
