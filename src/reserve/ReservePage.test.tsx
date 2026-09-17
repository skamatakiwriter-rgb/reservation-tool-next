import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReservePage } from './ReservePage'

beforeEach(() => {
  window.scrollTo = vi.fn()
})

function renderPage() {
  return render(<MemoryRouter><ReservePage /></MemoryRouter>)
}

describe('利用者予約画面', () => {
  it('3カテゴリーを表示し、選択後に入力画面と予約カレンダーを表示する', async () => {
    renderPage()
    expect(await screen.findByRole('button', { name: /蛍光管持込/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /家具家財撤去/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ビン缶回収/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /蛍光管持込/ }))
    expect(screen.getByRole('heading', { name: '蛍光管持込の予約内容' })).toBeInTheDocument()
    expect(screen.getByRole('grid', { name: /予約可能日/ })).toBeInTheDocument()
    expect(screen.getByLabelText(/おおよその本数/)).toBeInTheDocument()
  })

  it('空欄では確認へ進まず、項目別の修正案内を表示する', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /家具家財撤去/ }))
    fireEvent.click(screen.getByRole('button', { name: '入力内容を確認する' }))

    expect(screen.getByText('入力内容を確認してください')).toBeInTheDocument()
    expect(screen.getByText('会社名を入力してください。')).toBeInTheDocument()
    expect(screen.getByText('住所を入力してください。')).toBeInTheDocument()
  })

  it('蛍光管予約を確認して保存し、確定状態と受付番号を表示する', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /蛍光管持込/ }))
    fireEvent.change(screen.getByRole('textbox', { name: /^会社名/ }), { target: { value: '架空テスト商事' } })
    fireEvent.change(screen.getByRole('textbox', { name: /^担当者名/ }), { target: { value: '予約 花子' } })
    fireEvent.change(screen.getByRole('textbox', { name: /^電話番号/ }), { target: { value: '03-1234-5678' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: /^おおよその本数/ }), { target: { value: '20' } })
    fireEvent.click(screen.getAllByRole('gridcell', { name: /受付可/ })[0])
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '入力内容を確認する' }))

    expect(screen.getByText(/申込み後の状態は「確定」/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'この内容で申し込む' }))

    await waitFor(() => expect(screen.getByRole('heading', { name: '予約が確定しました' })).toBeInTheDocument())
    expect(screen.getByText(/R-/)).toBeInTheDocument()
    expect(screen.getByText('現在状態：確定')).toBeInTheDocument()
  })
})
