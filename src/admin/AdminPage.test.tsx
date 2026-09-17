import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminPage } from './AdminPage'

beforeEach(() => {
  sessionStorage.clear()
  window.confirm = vi.fn(() => true)
  window.prompt = vi.fn(() => '')
})

function renderPage() {
  return render(<MemoryRouter><AdminPage /></MemoryRouter>)
}

async function startAdmin() {
  fireEvent.click(screen.getByRole('button', { name: '管理画面を試す' }))
  await screen.findByText('受付件数')
}

describe('管理者画面', () => {
  it('パスワードなしの案内から、集計と管理カレンダーを表示する', async () => {
    renderPage()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    await startAdmin()
    expect(screen.getByText('デモ管理者モード')).toBeInTheDocument()
    expect(screen.getByText('確定件数')).toBeInTheDocument()
    expect(screen.getByRole('grid', { name: /管理カレンダー/ })).toBeInTheDocument()
    expect(screen.getByLabelText('カテゴリー')).toHaveValue('')
    const dayWithReceivedReservations = screen.getByRole('gridcell', { name: /2件/ })
    fireEvent.click(dayWithReceivedReservations)
    expect(within(screen.getByRole('complementary')).getAllByText('受付')).toHaveLength(2)
    expect(screen.getByRole('button', { name: '電話受付を登録' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '電話受付を登録' }))
    const editor = screen.getByRole('dialog', { name: '電話受付を登録' })
    expect(within(editor).getByLabelText('カテゴリー')).toHaveValue('keikoukan')
    expect(within(editor).getByLabelText('希望日')).not.toHaveValue('')
  })

  it('予約一覧を検索し、予約詳細と操作履歴を表示する', async () => {
    renderPage()
    await startAdmin()
    fireEvent.click(screen.getByRole('button', { name: '予約一覧' }))
    fireEvent.change(screen.getByPlaceholderText('受付番号・会社名・担当者名・電話番号'), { target: { value: 'DEMO-003' } })
    fireEvent.click(await screen.findByText('DEMO-003'))
    expect(screen.getByRole('dialog', { name: 'DEMO-003' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '操作履歴' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '確定' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'DEMO-003' }), { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'DEMO-003' })).not.toBeInTheDocument()
  })

  it('操作履歴を予約作成から現在の状態まで古い順に表示する', async () => {
    renderPage()
    await startAdmin()
    fireEvent.click(screen.getByRole('button', { name: '予約一覧' }))
    fireEvent.change(screen.getByPlaceholderText('受付番号・会社名・担当者名・電話番号'), { target: { value: 'DEMO-002' } })
    fireEvent.click(await screen.findByText('DEMO-002'))
    const dialog = screen.getByRole('dialog', { name: 'DEMO-002' })
    const history = within(dialog).getByRole('heading', { name: '操作履歴' }).parentElement!
    expect(Array.from(history.querySelectorAll('strong'), (item) => item.textContent)).toEqual([
      '予約作成',
      '取消',
      '新しい予約として再受付',
    ])
  })

  it('受付状態の予約を確定し、更新結果を表示する', async () => {
    renderPage()
    await startAdmin()
    fireEvent.click(screen.getByRole('button', { name: '予約一覧' }))
    fireEvent.change(screen.getByPlaceholderText('受付番号・会社名・担当者名・電話番号'), { target: { value: 'DEMO-003' } })
    fireEvent.click(await screen.findByText('DEMO-003'))
    fireEvent.click(screen.getByRole('button', { name: '確定' }))
    await waitFor(() => expect(screen.getByText('予約を「確定」に変更しました。')).toBeInTheDocument())
  })

  it('関連日追加では元予約のカテゴリーを引き継ぎ、日程確認を必須にする', async () => {
    renderPage()
    await startAdmin()
    fireEvent.click(screen.getByRole('button', { name: '予約一覧' }))
    fireEvent.change(screen.getByPlaceholderText('受付番号・会社名・担当者名・電話番号'), { target: { value: 'DEMO-003' } })
    fireEvent.click(await screen.findByText('DEMO-003'))
    fireEvent.click(screen.getByRole('button', { name: '関連する作業日を追加' }))
    const editor = screen.getByRole('dialog', { name: '関連する作業日を追加' })
    expect(within(editor).getByLabelText('カテゴリー')).toHaveValue('binkan')
    expect(within(editor).getByRole('checkbox', { name: '依頼者と追加日程を確認済み' })).not.toBeChecked()
  })

  it('取消予約の依頼者情報を使う場合は再受付画面であることを明示する', async () => {
    renderPage()
    await startAdmin()
    fireEvent.click(screen.getByRole('button', { name: '予約一覧' }))
    fireEvent.change(screen.getByPlaceholderText('受付番号・会社名・担当者名・電話番号'), { target: { value: 'DEMO-002' } })
    fireEvent.click(await screen.findByText('DEMO-002'))
    fireEvent.click(screen.getByRole('button', { name: 'この依頼者情報を使用する' }))
    const editor = screen.getByRole('dialog', { name: '取消予約から再受付' })
    expect(within(editor).getByText(/参照元：DEMO-002/)).toBeInTheDocument()
    expect(within(editor).getByLabelText('カテゴリー')).toHaveValue('kagu')
  })
})
