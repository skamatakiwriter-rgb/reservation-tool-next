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
  sessionStorage.clear()
})

afterEach(() => vi.useRealTimers())

describe('主要URL', () => {
  it('デモ入口を表示する', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { name: /予約から回収までを/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /利用者画面へ/ })).toHaveAttribute('href', '/reserve')
    expect(screen.getByRole('link', { name: /予約・配車管理へ/ })).toHaveAttribute('href', '/admin')
    expect(screen.getByRole('link', { name: /ドライバー画面へ/ })).toHaveAttribute('href', '/driver')
    expect(screen.getByRole('link', { name: /使い方ガイドを見る/ })).toHaveAttribute('href', '/guide')
    expect(screen.getByRole('link', { name: '保存データを管理する' })).toHaveAttribute('href', '/demo-data')
    expect(screen.getByRole('link', { name: 'データ管理' })).toHaveAttribute('href', '/demo-data')
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

  it('使い方ガイドを直接表示し、主要画面の確認順序を案内する', () => {
    renderAt('/guide')
    expect(screen.getByRole('heading', { name: '使い方ガイド' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '利用者画面' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '予約・配車管理' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'ドライバー管理' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '車両管理' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'ドライバー画面' })).toBeInTheDocument()
  })

  it('車両管理を直接表示する', () => {
    renderAt('/admin/vehicles')
    expect(screen.getByRole('heading', { name: '車両管理' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '予約・配車管理を開始する' })).toHaveAttribute('href', '/admin')
  })

  it('共通のデモデータ管理画面を直接表示する', async () => {
    renderAt('/demo-data')
    expect(await screen.findByRole('heading', { name: 'デモデータ管理' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '初期状態に戻す' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'デモデータを削除して入口へ戻る' })).toBeInTheDocument()
    expect(screen.getByText(/利用者・管理者・ドライバーの全画面に反映/)).toBeInTheDocument()
  })
})
