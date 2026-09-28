import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DriverPage } from './DriverPage'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-18T03:00:00.000Z'))
  window.confirm = vi.fn(() => true)
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

  it('任意の回収開始を記録し、一部回収として今回の配車を終了できる', async () => {
    render(<MemoryRouter><DriverPage /></MemoryRouter>)
    const driverSelect = await screen.findByLabelText('架空ドライバー')
    fireEvent.change(driverSelect, { target: { value: 'demo-driver-001' } })
    fireEvent.change(screen.getByLabelText('表示日'), { target: { value: '2026-09-26' } })
    const list = screen.getByRole('region', { name: '収集担当Aの担当案件' })
    fireEvent.click(await within(list).findByRole('button', { name: /DEMO-011/ }))
    fireEvent.click(screen.getByRole('button', { name: '回収開始を記録' }))
    await screen.findByText('回収開始を記録しました。')
    expect(screen.getAllByText('回収中')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '作業結果を登録' }))
    const resultDialog = screen.getByRole('dialog', { name: '作業結果を登録' })
    fireEvent.click(within(resultDialog).getByRole('radio', { name: /一部回収/ }))
    fireEvent.click(within(resultDialog).getByRole('button', { name: '作業結果を保存して終了' }))
    expect(await within(resultDialog).findByText('実際の回収内容を入力してください。')).toBeInTheDocument()
    fireEvent.change(within(resultDialog).getByLabelText(/実際の回収内容/), { target: { value: '空き缶 1袋を回収' } })
    fireEvent.change(within(resultDialog).getByLabelText(/結果・次回対応メモ/), { target: { value: '残り1袋は別日に回収する' } })
    fireEvent.click(within(resultDialog).getByRole('button', { name: '作業結果を保存して終了' }))
    expect(await screen.findByText(/一部回収として作業を終了しました/)).toBeInTheDocument()
    expect(screen.getByText('この日の担当案件はありません。')).toBeInTheDocument()
  })
})
