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
    expect(screen.getByText('DRV-DEMO-001')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ドライバーを登録' }))
    const dialog = screen.getByRole('dialog', { name: 'ドライバーを登録' })
    fireEvent.change(within(dialog).getByLabelText('ドライバーコード'), { target: { value: 'drv-demo-010' } })
    fireEvent.change(within(dialog).getByLabelText('氏名'), { target: { value: '架空 四郎' } })
    fireEvent.change(within(dialog).getByLabelText('表示名'), { target: { value: '収集担当D' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '登録する' }))
    expect(await screen.findByText('ドライバーを登録しました。')).toBeInTheDocument()
    expect(await screen.findByText('DRV-DEMO-010')).toBeInTheDocument()

    const row = screen.getByText('DRV-DEMO-010').closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: '編集' }))
    const editDialog = screen.getByRole('dialog', { name: 'ドライバー情報を編集' })
    expect(within(editDialog).getByLabelText('ドライバーコード')).toBeDisabled()
    fireEvent.change(within(editDialog).getByLabelText('表示名'), { target: { value: '回収担当D' } })
    fireEvent.click(within(editDialog).getByRole('button', { name: '変更を保存' }))
    expect(await screen.findByText('ドライバー情報を更新しました。')).toBeInTheDocument()
    expect(await screen.findByText('回収担当D')).toBeInTheDocument()
  })

  it('未完了の配車があるドライバーは無効にできない', async () => {
    render(<MemoryRouter><DriverManagementPage /></MemoryRouter>)
    const code = await screen.findByText('DRV-DEMO-001')
    fireEvent.click(within(code.closest('tr')!).getByRole('button', { name: '無効にする' }))
    expect(await screen.findByText(/未完了の配車が残っているため無効にできません/)).toBeInTheDocument()
    await waitFor(() => expect(within(code.closest('tr')!).getByText('有効')).toBeInTheDocument())
  })
})
