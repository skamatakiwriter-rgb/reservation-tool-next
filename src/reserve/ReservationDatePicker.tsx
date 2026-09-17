import { useMemo, useState } from 'react'
import {
  evaluateAvailability,
  registrationWindow,
  type CategoryId,
  type DemoSnapshot,
} from '../domain'
import { formatDate } from './format'

type Props = {
  categoryId: CategoryId
  today: string
  snapshot: DemoSnapshot
  value: string
  onChange: (date: string) => void
}

const weekdays = ['日', '月', '火', '水', '木', '金', '土']

export function ReservationDatePicker({ categoryId, today, snapshot, value, onChange }: Props) {
  const window = registrationWindow('public', today)
  const [visibleMonth, setVisibleMonth] = useState(() => window.minimumDate.slice(0, 7))
  const months = useMemo(() => monthRange(window.minimumDate, window.maximumDate), [window.minimumDate, window.maximumDate])
  const monthIndex = months.indexOf(visibleMonth)
  const days = calendarCells(visibleMonth)

  return (
    <section className="date-picker" aria-labelledby="date-picker-title">
      <div className="calendar-heading">
        <div>
          <span className="field-label" id="date-picker-title">希望日 <Required /></span>
          <p>{formatDate(window.minimumDate)}～{formatDate(window.maximumDate)}から選択してください。</p>
        </div>
        <div className="month-controls">
          <button type="button" className="icon-button" disabled={monthIndex <= 0} onClick={() => setVisibleMonth(months[monthIndex - 1])}>前月</button>
          <strong>{formatMonth(visibleMonth)}</strong>
          <button type="button" className="icon-button" disabled={monthIndex >= months.length - 1} onClick={() => setVisibleMonth(months[monthIndex + 1])}>翌月</button>
        </div>
      </div>
      <div className="calendar-grid" role="grid" aria-label={`${formatMonth(visibleMonth)}の予約可能日`}>
        {weekdays.map((day) => <span key={day} className="weekday" role="columnheader">{day}</span>)}
        {days.map((date, index) => {
          if (!date) return <span className="calendar-empty" key={`empty-${index}`} />
          const setting = snapshot.settings.find((item) => item.categoryId === categoryId)
          const closure = snapshot.closures.some((item) => item.date === date && item.categoryId === categoryId && item.isClosed)
          const result = evaluateAvailability({
            requestedDate: date,
            categoryId,
            channel: 'public',
            today,
            setting,
            isClosed: closure,
            reservations: snapshot.reservations,
          })
          const label = result.available ? (result.remaining === 1 ? '残りわずか' : '受付可') : unavailableLabel(result.reason)
          return (
            <button
              type="button"
              role="gridcell"
              key={date}
              className={`calendar-day ${value === date ? 'selected' : ''} ${result.available ? '' : 'unavailable'}`}
              disabled={!result.available}
              aria-label={`${formatDate(date)} ${label}`}
              onClick={() => onChange(date)}
            >
              <span>{Number(date.slice(-2))}</span><small>{label}</small>
            </button>
          )
        })}
      </div>
      <div className="calendar-legend" aria-label="表示の説明"><span>受付可</span><span>残りわずか</span><span>満枠・受付停止</span></div>
      {value && <p className="selected-date">選択中：<strong>{formatDate(value)}</strong></p>}
    </section>
  )
}

function monthRange(minimum: string, maximum: string): string[] {
  const result: string[] = []
  let current = `${minimum.slice(0, 7)}-01`
  const end = `${maximum.slice(0, 7)}-01`
  while (current <= end) {
    result.push(current.slice(0, 7))
    const [year, month] = current.split('-').map(Number)
    current = `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`
  }
  return result
}

function calendarCells(month: string): Array<string | undefined> {
  const [year, monthNumber] = month.split('-').map(Number)
  const firstDay = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay()
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  const prefix = Array.from<undefined>({ length: firstDay })
  const dates = Array.from({ length: lastDay }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`)
  return [...prefix, ...dates]
}

function unavailableLabel(reason: string): string {
  if (reason === 'full') return '満枠'
  if (reason === 'closed' || reason === 'zeroLimit') return '受付停止'
  if (reason === 'invalidSetting') return '確認中'
  if (reason === 'sunday') return '休業日'
  return '期間外'
}

function formatMonth(month: string): string {
  const [year, value] = month.split('-')
  return `${year}年${Number(value)}月`
}

function Required() { return <span className="required">必須</span> }
