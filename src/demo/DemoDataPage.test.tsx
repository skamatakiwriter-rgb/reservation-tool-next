import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { demoRepository } from '../reserve/useDemoData'
import { DemoDataPage } from './DemoDataPage'

beforeEach(() => {
  window.confirm = vi.fn(() => true)
  sessionStorage.setItem('reservation-demo-admin', 'active')
})

afterEach(() => vi.restoreAllMocks())

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/demo-data']}>
      <Routes>
        <Route path="/demo-data" element={<DemoDataPage />} />
        <Route path="/" element={<h1>デモ入口</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('デモデータ管理', () => {
  it('初期状態へ戻した結果を表示する', async () => {
    const reset = vi.spyOn(demoRepository, 'resetDemoData')
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '初期状態に戻す' }))
    await waitFor(() => expect(reset).toHaveBeenCalledOnce())
    expect(await screen.findByRole('status')).toHaveTextContent('デモデータを初期状態に戻しました。')
  })

  it('削除前に確認し、成功後は管理者モードを解除して入口へ戻る', async () => {
    const remove = vi.spyOn(demoRepository, 'deleteDemoData')
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'デモデータを削除して入口へ戻る' }))
    await waitFor(() => expect(remove).toHaveBeenCalledOnce())
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('元に戻せません'))
    expect(await screen.findByRole('heading', { name: 'デモ入口' })).toBeInTheDocument()
    expect(sessionStorage.getItem('reservation-demo-admin')).toBeNull()
  })

  it('削除確認を取り消した場合はデータを変更しない', async () => {
    window.confirm = vi.fn(() => false)
    const remove = vi.spyOn(demoRepository, 'deleteDemoData')
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'デモデータを削除して入口へ戻る' }))
    expect(remove).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'デモデータ管理' })).toBeInTheDocument()
  })
})
