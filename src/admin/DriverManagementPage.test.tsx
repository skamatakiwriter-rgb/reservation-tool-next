import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DriverManagementPage } from './DriverManagementPage'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-18T03:00:00.000Z'))
  sessionStorage.setItem('reservation-demo-admin', 'active')
  window.confirm = vi.fn(() => true)
})

afterEach(() => {
  sessionStorage.clear()
  vi.useRealTimers()
})

describe('ドライバー管理画面', () => {
  it('一覧から登録・編集できる', async () => {
    render(<MemoryRouter><DriverManagementPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: '登録ドライバー' })).toBeInTheDocument()
    expect(screen.getByText('DRV-0001')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ドライバーを登録' }))
    const dialog = screen.getByRole('dialog', { name: 'ドライバーを登録' })
    fireEvent.change(within(dialog).getByLabelText('氏名'), { target: { value: '架空 四郎' } })
    expect(within(dialog).queryByLabelText('表示名')).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText('ドライバーコード')).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '登録する' }))
    expect(await screen.findByText('ドライバーを登録しました。')).toBeInTheDocument()
    expect(await screen.findByText('DRV-0004')).toBeInTheDocument()

    const row = screen.getByText('DRV-0004').closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: '編集' }))
    const editDialog = screen.getByRole('dialog', { name: 'ドライバー情報を編集' })
    fireEvent.change(within(editDialog).getByLabelText('氏名'), { target: { value: '架空 四郎（研修済み）' } })
    fireEvent.click(within(editDialog).getByRole('button', { name: '変更を保存' }))
    expect(await screen.findByText('ドライバー情報を更新しました。')).toBeInTheDocument()
    expect(await screen.findByText('架空 四郎（研修済み）')).toBeInTheDocument()
  })

  it('未完了の配車があるドライバーは無効にできない', async () => {
    render(<MemoryRouter><DriverManagementPage /></MemoryRouter>)
    const code = await screen.findByText('DRV-0001')
    fireEvent.click(within(code.closest('tr')!).getByRole('button', { name: '無効にする' }))
    expect(await screen.findByText(/未完了の配車が残っているため無効にできません/)).toBeInTheDocument()
    await waitFor(() => expect(within(code.closest('tr')!).getByText('有効')).toBeInTheDocument())
  })

  it('登録画面へフォーカスを移し、Escで閉じて呼出元へ戻す', async () => {
    render(<MemoryRouter><DriverManagementPage /></MemoryRouter>)
    const opener = await screen.findByRole('button', { name: 'ドライバーを登録' })
    opener.focus()
    fireEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'ドライバーを登録' })
    expect(dialog).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'ドライバーを登録' })).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })
})
