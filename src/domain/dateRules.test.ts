import { describe, expect, it } from 'vitest'
import {
  addCalendarDays,
  endOfMonthAfter,
  isSunday,
  isValidDateOnly,
  registrationWindow,
  todayInJapan,
  validateRequestedDate,
} from './dateRules'

describe('日本時間と日付計算', () => {
  it('UTC上では前日でも日本時間の今日を返す', () => {
    expect(todayInJapan(new Date('2026-09-13T15:30:00Z'))).toBe('2026-09-14')
  })

  it('月末・年末をまたいで暦日を加算する', () => {
    expect(addCalendarDays('2026-12-30', 3)).toBe('2027-01-02')
  })

  it('当月から3か月後の月末を返す', () => {
    expect(endOfMonthAfter('2026-09-14', 3)).toBe('2026-12-31')
    expect(endOfMonthAfter('2026-11-30', 3)).toBe('2027-02-28')
  })

  it('存在しない日付を拒否する', () => {
    expect(isValidDateOnly('2026-02-29')).toBe(false)
    expect(isValidDateOnly('2026-09-14')).toBe(true)
  })

  it('日曜日を判定する', () => {
    expect(isSunday('2026-09-20')).toBe(true)
    expect(isSunday('2026-09-19')).toBe(false)
  })
})

describe('受付期間', () => {
  const today = '2026-09-14'

  it('利用者は今日から3暦日後以降', () => {
    expect(registrationWindow('public', today)).toEqual({ minimumDate: '2026-09-17', maximumDate: '2026-12-31' })
    expect(validateRequestedDate('2026-09-16', 'public', today)).toMatchObject({ ok: false, reason: 'beforeStart' })
    expect(validateRequestedDate('2026-09-17', 'public', today)).toMatchObject({ ok: true })
  })

  it('管理者は今日以降', () => {
    expect(validateRequestedDate('2026-09-13', 'admin', today)).toMatchObject({ ok: false, reason: 'beforeStart' })
    expect(validateRequestedDate('2026-09-14', 'admin', today)).toMatchObject({ ok: true })
  })

  it('3か月後の月末翌日を拒否する', () => {
    expect(validateRequestedDate('2026-12-31', 'public', today)).toMatchObject({ ok: true })
    expect(validateRequestedDate('2027-01-01', 'public', today)).toMatchObject({ ok: false, reason: 'afterEnd' })
  })

  it('期間内の日曜日を拒否する', () => {
    expect(validateRequestedDate('2026-09-20', 'public', today)).toMatchObject({ ok: false, reason: 'sunday' })
  })
})
