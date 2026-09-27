import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DriverPage } from './DriverPage'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-18T03:00:00.000Z'))
})

afterEach(() => vi.useRealTimers())

describe('ドライバー画面', () => {
  it('初期状態では架空ドライバーの選択を案内する', async () => {
    render(<MemoryRouter><DriverPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'ドライバー担当画面' })).toBeInTheDocument()
    expect(screen.getByText('担当ドライバーを選択してください')).toBeInTheDocument()
    expect(screen.getByText(/本番のログイン・本人確認を再現するものではありません/)).toBeInTheDocument()
  })

  it('担当案件から依頼時申告とドライバー向け指示を確認できる', async () => {
    render(<MemoryRouter><DriverPage /></MemoryRouter>)
    const driverSelect = await screen.findByLabelText('架空ドライバー')
    fireEvent.change(driverSelect, { target: { value: 'demo-driver-002' } })
    const list = screen.getByRole('region', { name: '収集担当Bの担当案件' })
    fireEvent.click(await within(list).findByRole('button', { name: /DEMO-012/ }))
    expect(screen.getByRole('heading', { name: '依頼時申告・目安' })).toBeInTheDocument()
    expect(screen.getByText('現場到着前に配車担当へ電話で確認')).toBeInTheDocument()
    expect(screen.queryByText(/現場で想定より量が多かったため/)).not.toBeInTheDocument()
  })
})
