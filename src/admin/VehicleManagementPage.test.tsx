import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VehicleManagementPage } from './VehicleManagementPage'

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

describe('車両管理画面', () => {
  it('車両ナンバーを使って登録・編集できる', async () => {
    render(<MemoryRouter><VehicleManagementPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: '登録車両' })).toBeInTheDocument()
    expect(screen.getByText('VEH-0001')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '車両を登録' }))
    const dialog = screen.getByRole('dialog', { name: '車両を登録' })
    fireEvent.change(within(dialog).getByLabelText('車両ナンバー'), { target: { value: 'デモ 500 え 00-04' } })
    fireEvent.change(within(dialog).getByLabelText('車種'), { target: { value: '4t箱車' } })
    expect(within(dialog).queryByLabelText('表示名')).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText('車両コード')).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '登録する' }))
    expect(await screen.findByText('車両を登録しました。')).toBeInTheDocument()
    expect(await screen.findByText('VEH-0004')).toBeInTheDocument()

    const row = screen.getByText('VEH-0004').closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: '編集' }))
    const editDialog = screen.getByRole('dialog', { name: '車両情報を編集' })
    fireEvent.change(within(editDialog).getByLabelText('用途・注意事項'), { target: { value: '架空の注意事項' } })
    fireEvent.click(within(editDialog).getByRole('button', { name: '変更を保存' }))
    expect(await screen.findByText('車両情報を更新しました。')).toBeInTheDocument()
    expect(await screen.findByText('架空の注意事項')).toBeInTheDocument()
  })

  it('未完了配車と車両保留がある車両は無効にできない', async () => {
    render(<MemoryRouter><VehicleManagementPage /></MemoryRouter>)
    const assignedCode = await screen.findByText('VEH-0001')
    fireEvent.click(within(assignedCode.closest('tr')!).getByRole('button', { name: '無効にする' }))
    expect(await screen.findByText(/未完了の配車が残っているため無効にできません/)).toBeInTheDocument()
    await waitFor(() => expect(within(assignedCode.closest('tr')!).getByText('有効')).toBeInTheDocument())

    const heldCode = screen.getByText('VEH-0003')
    fireEvent.click(within(heldCode.closest('tr')!).getByRole('button', { name: '無効にする' }))
    expect(await screen.findByText(/積み置き中のため無効にできません/)).toBeInTheDocument()
  })

  it('登録画面へフォーカスを移し、Escで閉じて呼出元へ戻す', async () => {
    render(<MemoryRouter><VehicleManagementPage /></MemoryRouter>)
    const opener = await screen.findByRole('button', { name: '車両を登録' })
    opener.focus()
    fireEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: '車両を登録' })
    expect(dialog).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '車両を登録' })).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })
})
