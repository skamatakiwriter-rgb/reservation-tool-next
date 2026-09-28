import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { DispatchAssignment, Reservation } from '../domain'
import { CollectionOutcomeDialog } from './CollectionOutcomeDialog'

const reservation = {
  reservationId: 'reservation-1', reservationCode: 'DEMO-001', companyName: '架空商事',
} as Reservation

const assignment = {
  dispatchId: 'dispatch-1', plannedDate: '2026-09-18', plannedStartTime: '09:00', plannedEndTime: '10:00', status: 'assigned',
} as DispatchAssignment

function Harness({ onSubmit = async () => undefined }: { onSubmit?: () => Promise<string | undefined> }) {
  const [open, setOpen] = useState(false)
  return <><button type="button" onClick={() => setOpen(true)}>結果入力を開く</button>{open && <CollectionOutcomeDialog reservation={reservation} assignment={assignment} vehicleName="架空車両" driverName="架空担当者" allowVehicleHold={false} onClose={() => setOpen(false)} onSubmit={onSubmit} />}</>
}

describe('作業結果ダイアログ', () => {
  it('フォーカスを内部に移し、循環させ、閉じた後に呼出元へ戻す', () => {
    render(<Harness />)
    const opener = screen.getByRole('button', { name: '結果入力を開く' })
    opener.focus()
    fireEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: '作業結果を登録' })
    expect(dialog).toHaveFocus()

    const close = within(dialog).getByRole('button', { name: '作業結果画面を閉じる' })
    const save = within(dialog).getByRole('button', { name: '作業結果を保存して終了' })
    save.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(close).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(save).toHaveFocus()

    fireEvent.click(close)
    expect(opener).toHaveFocus()
  })

  it('保存処理中の二重送信を防ぐ', () => {
    let finish: ((value: string | undefined) => void) | undefined
    const onSubmit = vi.fn(() => new Promise<string | undefined>((resolve) => { finish = resolve }))
    render(<Harness onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole('button', { name: '結果入力を開く' }))
    const dialog = screen.getByRole('dialog', { name: '作業結果を登録' })
    fireEvent.click(within(dialog).getByRole('radio', { name: /全量回収/ }))
    const save = within(dialog).getByRole('button', { name: '作業結果を保存して終了' })
    fireEvent.click(save)
    fireEvent.click(save)
    expect(onSubmit).toHaveBeenCalledTimes(1)
    finish?.(undefined)
  })
})
