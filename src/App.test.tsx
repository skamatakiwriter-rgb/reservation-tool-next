import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import App from './App'

function renderAt(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
}

describe('主要URL', () => {
  it('デモ入口を表示する', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { name: /予約受付と管理を/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /利用者画面へ/ })).toHaveAttribute('href', '/reserve')
    expect(screen.getByRole('link', { name: /管理者画面へ/ })).toHaveAttribute('href', '/admin')
  })

  it('利用者画面を直接表示する', () => {
    renderAt('/reserve')
    expect(screen.getByRole('heading', { name: '利用者用 予約申込み' })).toBeInTheDocument()
  })

  it('管理者画面を直接表示する', () => {
    renderAt('/admin')
    expect(screen.getByRole('heading', { name: '管理者用 予約管理' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '管理画面を試す' })).toBeInTheDocument()
  })
})
