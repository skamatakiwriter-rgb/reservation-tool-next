import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

function renderAt(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-18T03:00:00.000Z'))
})

afterEach(() => vi.useRealTimers())

describe('主要URL', () => {
  it('デモ入口を表示する', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { name: /予約から回収までを/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /利用者画面へ/ })).toHaveAttribute('href', '/reserve')
    expect(screen.getByRole('link', { name: /予約・配車管理へ/ })).toHaveAttribute('href', '/admin')
    expect(screen.getByRole('link', { name: /ドライバー画面へ/ })).toHaveAttribute('href', '/driver')
    expect(screen.getByText(/本番の認証機能はなく、異なるブラウザや端末とはデータを共有しません/)).toBeInTheDocument()
  })

  it('利用者画面を直接表示する', () => {
    renderAt('/reserve')
    expect(screen.getByRole('heading', { name: '利用者用 予約申込み' })).toBeInTheDocument()
  })

  it('管理者画面を直接表示する', () => {
    renderAt('/admin')
    expect(screen.getByRole('heading', { name: '管理者用 予約・配車管理' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '管理画面を試す' })).toBeInTheDocument()
  })

  it('ドライバー画面を直接表示する', async () => {
    renderAt('/driver')
    expect(await screen.findByRole('heading', { name: 'ドライバー担当画面' })).toBeInTheDocument()
    expect(screen.getByLabelText('架空ドライバー')).toHaveValue('')
    expect(screen.getByText(/デモデータはこのブラウザ内に保存されます/)).toBeInTheDocument()
    expect(screen.getByText(/本番の認証機能はなく、異なるブラウザや端末とはデータを共有しません/)).toBeInTheDocument()
  })
})
