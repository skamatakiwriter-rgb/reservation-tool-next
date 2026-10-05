import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DriverPage } from './DriverPage'
import { demoRepository } from '../reserve/useDemoData'

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
    const list = screen.getByRole('region', { name: '架空 次郎の担当案件' })
    fireEvent.click(await within(list).findByRole('button', { name: /DEMO-012/ }))
    expect(screen.getByRole('heading', { name: '依頼時申告・目安' })).toBeInTheDocument()
    expect(screen.getByText('現場到着前に配車担当へ電話で確認')).toBeInTheDocument()
    expect(screen.queryByText(/現場で想定より量が多かったため/)).not.toBeInTheDocument()
  })

  it('選択したドライバーの予定だけを期間内で日付別に表示する', async () => {
    render(<MemoryRouter><DriverPage /></MemoryRouter>)
    const driverSelect = await screen.findByLabelText('架空ドライバー')
    fireEvent.change(driverSelect, { target: { value: 'demo-driver-001' } })
    fireEvent.click(screen.getByRole('button', { name: '期間を指定' }))
    fireEvent.change(screen.getByLabelText('開始日'), { target: { value: '2026-09-18' } })
    fireEvent.change(screen.getByLabelText('終了日'), { target: { value: '2026-09-27' } })
    const list = screen.getByRole('region', { name: '架空 太郎の担当案件' })
    expect(within(list).getByText(/DEMO-011/)).toBeInTheDocument()
    expect(within(list).queryByText(/DEMO-012/)).not.toBeInTheDocument()
    expect(screen.getByText(/今後の予定は、配車変更により更新される場合があります/)).toBeInTheDocument()
  })

  it('配車後の予約変更を変更項目の欄で強調表示する', async () => {
    render(<MemoryRouter><DriverPage /></MemoryRouter>)
    const driverSelect = await screen.findByLabelText('架空ドライバー')
    fireEvent.change(driverSelect, { target: { value: 'demo-driver-001' } })
    fireEvent.click(screen.getByRole('button', { name: '期間を指定' }))
    fireEvent.change(screen.getByLabelText('開始日'), { target: { value: '2026-09-28' } })
    fireEvent.change(screen.getByLabelText('終了日'), { target: { value: '2026-09-28' } })
    const list = screen.getByRole('region', { name: '架空 太郎の担当案件' })
    fireEvent.click(await within(list).findByRole('button', { name: /DEMO-016/ }))
    expect(within(list).getByText('要確認')).toBeInTheDocument()
    expect(within(list).getByText('要確認 1件')).toBeInTheDocument()
    expect(screen.getByText('予約・配車内容が変更されています')).toBeInTheDocument()
    expect(screen.getByText('赤い「要確認」が付いた項目を確認し、下の確認ボタンを押してください。')).toBeInTheDocument()
    expect(screen.queryByText(/配車担当者へ連絡/)).not.toBeInTheDocument()
    const answerSection = screen.getByRole('heading', { name: /依頼時申告・目安/ }).parentElement!
    expect(within(answerSection).getByText('要確認')).toBeInTheDocument()
    expect(answerSection).toHaveTextContent('変更前：棚 1台')
    expect(answerSection).toHaveTextContent('現在：棚 2台')
    const history = screen.getByRole('region', { name: '配車後の変更履歴' })
    const confirmButton = screen.getByRole('button', { name: '変更内容を確認しました' })
    expect(confirmButton.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(history).toHaveTextContent('1件')
    expect(history).toHaveTextContent('棚 1台')
    expect(history).toHaveTextContent('棚 2台')
    expect(screen.getByRole('button', { name: '回収開始を記録' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '作業結果を登録' })).toBeDisabled()
    fireEvent.click(confirmButton)
    await screen.findByText('変更内容を確認済みにしました。')
    expect(screen.queryByText('予約・配車内容が変更されています')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '変更内容を確認しました' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '配車後の変更履歴' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '回収開始を記録' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '作業結果を登録' })).toBeEnabled()
  })

  it('任意の回収開始を記録し、一部回収として今回の配車を終了できる', async () => {
    render(<MemoryRouter><DriverPage /></MemoryRouter>)
    const driverSelect = await screen.findByLabelText('架空ドライバー')
    fireEvent.change(driverSelect, { target: { value: 'demo-driver-001' } })
    fireEvent.click(screen.getByRole('button', { name: '期間を指定' }))
    fireEvent.change(screen.getByLabelText('開始日'), { target: { value: '2026-09-26' } })
    fireEvent.change(screen.getByLabelText('終了日'), { target: { value: '2026-09-26' } })
    const list = screen.getByRole('region', { name: '架空 太郎の担当案件' })
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
    expect(screen.getByText('この期間の担当案件はありません。')).toBeInTheDocument()
  })

  it('旧担当者の予定から案件を外し、担当変更通知を確認後も履歴に残す', async () => {
    const snapshot = await demoRepository.snapshot()
    const reservation = snapshot.reservations.find((item) => item.reservationId === 'demo-reservation-016')!
    const assignment = snapshot.dispatchAssignments.find((item) => item.reservationId === reservation.reservationId)!
    const changed = await demoRepository.updateDispatch({ generationId: snapshot.metadata!.generationId, idempotencyKey: crypto.randomUUID(), actor: 'demo-admin', reservationId: reservation.reservationId, expectedReservationVersion: reservation.version, dispatchId: assignment.dispatchId, expectedDispatchVersion: assignment.version, plannedDate: assignment.plannedDate, plannedStartTime: assignment.plannedStartTime, plannedEndTime: assignment.plannedEndTime, vehicleId: assignment.vehicleId, primaryDriverId: 'demo-driver-003', driverInstructions: assignment.driverInstructions })
    expect(changed.kind).toBe('success')

    render(<MemoryRouter><DriverPage /></MemoryRouter>)
    fireEvent.change(await screen.findByLabelText('架空ドライバー'), { target: { value: 'demo-driver-001' } })
    fireEvent.click(screen.getByRole('button', { name: '期間を指定' }))
    fireEvent.change(screen.getByLabelText('開始日'), { target: { value: assignment.plannedDate } })
    fireEvent.change(screen.getByLabelText('終了日'), { target: { value: assignment.plannedDate } })
    const notice = await screen.findByRole('region', { name: '担当変更のお知らせ' })
    expect(notice).toHaveTextContent('DEMO-016は、あなたの担当から外れました')
    expect(notice).toHaveTextContent('現在の担当：架空 三郎')
    expect(within(screen.getByRole('region', { name: '架空 太郎の担当案件' })).queryByText('DEMO-016')).not.toBeInTheDocument()
    fireEvent.click(within(notice).getByRole('button', { name: '担当変更を確認しました' }))
    await screen.findByText('担当変更を確認済みにしました。')
    expect(screen.queryByRole('button', { name: '担当変更を確認しました' })).not.toBeInTheDocument()
    expect(screen.getByText('担当変更履歴（1件）')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('架空ドライバー'), { target: { value: 'demo-driver-003' } })
    const newDriverList = screen.getByRole('region', { name: '架空 三郎の担当案件' })
    expect(within(newDriverList).getByText(/DEMO-016/)).toBeInTheDocument()
    expect(within(newDriverList).getByText('要確認')).toBeInTheDocument()
  })

  it('担当を戻して再変更しても最新状態だけを通知し、途中の変更は履歴へまとめる', async () => {
    const current = await demoRepository.snapshot()
    expect((await demoRepository.resetDemoData(current.metadata!.generationId)).kind).toBe('success')
    const changeDriver = async (primaryDriverId: string) => {
      const snapshot = await demoRepository.snapshot()
      const reservation = snapshot.reservations.find((item) => item.reservationId === 'demo-reservation-016')!
      const assignment = snapshot.dispatchAssignments.find((item) => item.reservationId === reservation.reservationId)!
      const result = await demoRepository.updateDispatch({ generationId: snapshot.metadata!.generationId, idempotencyKey: crypto.randomUUID(), actor: 'demo-admin', reservationId: reservation.reservationId, expectedReservationVersion: reservation.version, dispatchId: assignment.dispatchId, expectedDispatchVersion: assignment.version, plannedDate: assignment.plannedDate, plannedStartTime: assignment.plannedStartTime, plannedEndTime: assignment.plannedEndTime, vehicleId: assignment.vehicleId, primaryDriverId, driverInstructions: assignment.driverInstructions })
      expect(result.kind).toBe('success')
      return assignment.plannedDate
    }

    await changeDriver('demo-driver-003')
    const plannedDate = await changeDriver('demo-driver-001')
    const firstView = render(<MemoryRouter><DriverPage /></MemoryRouter>)
    fireEvent.change(await screen.findByLabelText('架空ドライバー'), { target: { value: 'demo-driver-001' } })
    fireEvent.click(screen.getByRole('button', { name: '期間を指定' }))
    fireEvent.change(screen.getByLabelText('開始日'), { target: { value: plannedDate } })
    fireEvent.change(screen.getByLabelText('終了日'), { target: { value: plannedDate } })
    const returnedList = screen.getByRole('region', { name: '架空 太郎の担当案件' })
    expect(within(returnedList).getByText('再担当')).toBeInTheDocument()
    expect(within(returnedList).getByText('要確認')).toBeInTheDocument()
    const returnedHistory = screen.getByRole('region', { name: '担当変更のお知らせ' })
    expect(returnedHistory).toHaveTextContent('DEMO-016は架空 三郎から、再びあなたの担当になりました')
    expect(returnedHistory).toHaveTextContent('現在の予定：2026年9月28日 09:00–10:00')
    expect(returnedHistory).toHaveTextContent('担当変更時：架空 三郎 → 架空 太郎')
    expect(returnedHistory).toHaveTextContent('担当変更時：架空 太郎 → 架空 三郎')
    expect(returnedHistory).not.toHaveTextContent('現在の担当：')
    expect(returnedHistory).toHaveTextContent('後続の担当変更により、確認対象ではなくなりました。')
    expect(returnedHistory).toHaveTextContent('担当変更履歴（2件）')
    expect(within(returnedHistory).queryByRole('button', { name: '担当変更を確認しました' })).not.toBeInTheDocument()
    firstView.unmount()

    await changeDriver('demo-driver-002')
    render(<MemoryRouter><DriverPage /></MemoryRouter>)
    fireEvent.change(await screen.findByLabelText('架空ドライバー'), { target: { value: 'demo-driver-001' } })
    fireEvent.click(screen.getByRole('button', { name: '期間を指定' }))
    fireEvent.change(screen.getByLabelText('開始日'), { target: { value: plannedDate } })
    fireEvent.change(screen.getByLabelText('終了日'), { target: { value: plannedDate } })
    const notice = screen.getByRole('region', { name: '担当変更のお知らせ' })
    expect(notice).toHaveTextContent('DEMO-016は、あなたの担当から外れました')
    expect(notice).toHaveTextContent('現在の担当：架空 次郎')
    expect(notice).toHaveTextContent('担当変更時：架空 太郎 → 架空 三郎')
    expect(notice).toHaveTextContent('担当変更時：架空 三郎 → 架空 太郎')
    expect(within(notice).getAllByRole('button', { name: '担当変更を確認しました' })).toHaveLength(1)
    expect(notice).toHaveTextContent('担当変更履歴（2件）')
  })

  it('予定日をまたいで再変更した場合も古い解除履歴を確認対象へ戻さない', async () => {
    const current = await demoRepository.snapshot()
    expect((await demoRepository.resetDemoData(current.metadata!.generationId)).kind).toBe('success')
    let snapshot = await demoRepository.snapshot()
    let reservation = snapshot.reservations.find((item) => item.reservationId === 'demo-reservation-016')!
    let assignment = snapshot.dispatchAssignments.find((item) => item.reservationId === reservation.reservationId)!
    const updateDispatch = async (primaryDriverId: string, plannedDate: string) => {
      const result = await demoRepository.updateDispatch({ generationId: snapshot.metadata!.generationId, idempotencyKey: crypto.randomUUID(), actor: 'demo-admin', reservationId: reservation.reservationId, expectedReservationVersion: reservation.version, dispatchId: assignment.dispatchId, expectedDispatchVersion: assignment.version, plannedDate, plannedStartTime: assignment.plannedStartTime, plannedEndTime: assignment.plannedEndTime, vehicleId: assignment.vehicleId, primaryDriverId, driverInstructions: assignment.driverInstructions })
      expect(result.kind).toBe('success')
      snapshot = await demoRepository.snapshot()
      reservation = snapshot.reservations.find((item) => item.reservationId === reservation.reservationId)!
      assignment = snapshot.dispatchAssignments.find((item) => item.dispatchId === assignment.dispatchId)!
    }

    const oldDate = assignment.plannedDate
    await updateDispatch('demo-driver-003', oldDate)
    const newDate = '2026-09-29'
    const reservationChanged = await demoRepository.updateReservation({
      generationId: snapshot.metadata!.generationId,
      idempotencyKey: crypto.randomUUID(),
      actor: 'demo-admin',
      reservationId: reservation.reservationId,
      expectedVersion: reservation.version,
      input: { categoryId: reservation.categoryId, requestedDate: newDate, companyName: reservation.companyName, contactName: reservation.contactName, phone: reservation.phoneDisplay, address: reservation.address, contactNotes: reservation.contactNotes, categoryAnswers: reservation.categoryAnswers },
    })
    expect(reservationChanged.kind).toBe('success')
    snapshot = await demoRepository.snapshot()
    reservation = snapshot.reservations.find((item) => item.reservationId === reservation.reservationId)!
    assignment = snapshot.dispatchAssignments.find((item) => item.dispatchId === assignment.dispatchId)!
    await updateDispatch('demo-driver-001', newDate)
    await updateDispatch('demo-driver-002', newDate)

    render(<MemoryRouter><DriverPage /></MemoryRouter>)
    fireEvent.change(await screen.findByLabelText('架空ドライバー'), { target: { value: 'demo-driver-001' } })
    fireEvent.click(screen.getByRole('button', { name: '期間を指定' }))
    fireEvent.change(screen.getByLabelText('開始日'), { target: { value: oldDate } })
    fireEvent.change(screen.getByLabelText('終了日'), { target: { value: oldDate } })
    const history = screen.getByRole('region', { name: '担当変更のお知らせ' })
    expect(history).toHaveTextContent('担当変更履歴')
    expect(history).toHaveTextContent('後続の担当変更により、確認対象ではなくなりました。')
    expect(within(history).queryByRole('button', { name: '担当変更を確認しました' })).not.toBeInTheDocument()
  })
})
