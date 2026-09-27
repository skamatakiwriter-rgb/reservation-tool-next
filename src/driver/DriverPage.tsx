import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { categories, todayInJapan, type DemoSnapshot, type DispatchAssignment, type Reservation } from '../domain'
import { formatDate } from '../reserve/format'
import { useDemoData } from '../reserve/useDemoData'
import './DriverPage.css'

const dispatchLabels = { assigned: '配車済み', inProgress: '回収中', completed: '作業終了', cancelled: '配車取消' } as const

export function DriverPage() {
  const { snapshot, loading, error } = useDemoData('driver')
  const [driverId, setDriverId] = useState('')
  const [date, setDate] = useState(todayInJapan())
  const [selectedDispatchId, setSelectedDispatchId] = useState<string>()
  const assignments = useMemo(() => {
    if (!snapshot || !driverId) return []
    return snapshot.dispatchAssignments.filter((item) => item.primaryDriverId === driverId && item.plannedDate === date && (item.status === 'assigned' || item.status === 'inProgress')).sort((a, b) => a.plannedStartTime.localeCompare(b.plannedStartTime) || (reservationFor(snapshot.reservations, a)?.reservationCode ?? '').localeCompare(reservationFor(snapshot.reservations, b)?.reservationCode ?? ''))
  }, [date, driverId, snapshot])
  const selected = assignments.find((item) => item.dispatchId === selectedDispatchId)
  const selectedReservation = selected && snapshot ? reservationFor(snapshot.reservations, selected) : undefined

  if (loading) return <div className="page driver-page"><p className="driver-loading">担当データを読み込んでいます…</p></div>
  if (error || !snapshot?.metadata) return <div className="page driver-page"><div className="error-summary" role="alert">{error ?? '担当データを読み込めませんでした。'}</div></div>
  const activeDrivers = snapshot.drivers.filter((item) => item.isActive)
  const selectedDriver = activeDrivers.find((item) => item.driverId === driverId)

  return <div className="driver-page">
    <header className="driver-hero"><div><span className="driver-mode-badge">公開デモ版</span><h1>ドライバー担当画面</h1><p>担当案件と現場で必要な情報をスマートフォンから確認する想定の画面です。</p></div><Link to="/">デモ入口へ戻る</Link></header>
    <div className="driver-content">
      <div className="driver-demo-notice" role="note"><strong>デモ用の担当者選択です</strong><span>本番のログイン・本人確認を再現するものではありません。</span></div>
      <section className="driver-controls" aria-label="担当者と表示日"><label>架空ドライバー<select value={driverId} onChange={(event) => { setDriverId(event.target.value); setSelectedDispatchId(undefined) }}><option value="">選択してください</option>{activeDrivers.map((driver) => <option value={driver.driverId} key={driver.driverId}>{driver.displayName}</option>)}</select></label><div className="driver-date-controls"><button type="button" onClick={() => { setDate(addDays(date, -1)); setSelectedDispatchId(undefined) }}>前日</button><label>表示日<input type="date" value={date} onChange={(event) => { setDate(event.target.value); setSelectedDispatchId(undefined) }} /></label><button type="button" onClick={() => { setDate(addDays(date, 1)); setSelectedDispatchId(undefined) }}>翌日</button></div></section>
      {!selectedDriver ? <section className="driver-empty"><h2>担当ドライバーを選択してください</h2><p>選択すると、その日の担当案件が予定時刻順に表示されます。</p></section> : <div className="driver-layout">
        <section className="driver-list" aria-label={`${selectedDriver.displayName}の担当案件`}><header><div><span>{selectedDriver.displayName}</span><h2>{formatDate(date)}の担当</h2></div><strong>{assignments.length}件</strong></header>{assignments.length === 0 ? <p className="driver-empty-list">この日の担当案件はありません。</p> : assignments.map((assignment) => {
          const reservation = reservationFor(snapshot.reservations, assignment); const vehicle = snapshot.vehicles.find((item) => item.vehicleId === assignment.vehicleId); if (!reservation) return null
          return <button type="button" className={`driver-job ${selectedDispatchId === assignment.dispatchId ? 'selected' : ''}`} key={assignment.dispatchId} onClick={() => setSelectedDispatchId(assignment.dispatchId)}><span className="driver-time">{assignment.plannedStartTime}–{assignment.plannedEndTime}</span><span className="driver-job-main"><strong>{reservation.companyName}</strong><small>{categoryName(reservation)}・{reservation.reservationCode}</small><small>{reservation.address || '指定回収先なし'}</small></span><span className={`dispatch-chip ${assignment.status}`}>{dispatchLabels[assignment.status]}</span>{assignment.needsReview && <span className="driver-warning">予約内容の変更あり</span>}{vehicle?.loadHold && <span className="driver-warning danger">車両保留中</span>}</button>
        })}</section>
        <section className="driver-detail" aria-live="polite">{selected && selectedReservation ? <DriverAssignmentDetail assignment={selected} reservation={selectedReservation} snapshot={snapshot} /> : <div className="driver-detail-empty"><h2>案件を選択してください</h2><p>依頼時申告、連絡事項、ドライバー向け指示を確認できます。</p></div>}</section>
      </div>}
    </div>
  </div>
}

function DriverAssignmentDetail({ assignment, reservation, snapshot }: { assignment: DispatchAssignment; reservation: Reservation; snapshot: DemoSnapshot }) {
  const vehicle = snapshot.vehicles.find((item) => item.vehicleId === assignment.vehicleId)
  return <><div className="driver-detail-heading"><div><span>{reservation.reservationCode}</span><h2>{reservation.companyName}</h2></div><span className={`dispatch-chip ${assignment.status}`}>{dispatchLabels[assignment.status]}</span></div>{assignment.needsReview && <div className="driver-alert"><strong>予約内容が配車後に変更されています</strong><span>出発前に配車担当者へ確認してください。</span></div>}{vehicle?.loadHold && <div className="driver-alert danger"><strong>{vehicle.displayName}は{vehicle.loadHold.status === 'decisionPending' ? '搬入判断待ち' : '積み置き中'}です</strong><span>この画面では変更せず、配車担当者へ連絡してください。</span></div>}<dl className="driver-detail-grid"><Detail label="予定日時" value={`${formatDate(assignment.plannedDate)} ${assignment.plannedStartTime}–${assignment.plannedEndTime}`} /><Detail label="担当車両" value={vehicle?.displayName ?? '車両情報なし'} /><Detail label="担当者" value={reservation.contactName} /><Detail label="電話番号" value={reservation.phoneDisplay} /><Detail label="回収先" value={reservation.address || '指定回収先なし'} /><Detail label="カテゴリー" value={categoryName(reservation)} /></dl><section className="driver-information"><h3>依頼時申告・目安</h3><p>{answerValue(reservation)}</p><small>依頼者から受付時に申告された内容です。実際の回収量と異なる場合があります。</small></section><section className="driver-information"><h3>顧客からの連絡事項</h3><p>{reservation.contactNotes || 'なし'}</p></section><section className="driver-information instructions"><h3>ドライバー向け指示</h3><p>{assignment.driverInstructions || '指示はありません。'}</p></section><div className="driver-future-actions"><span>操作機能は次の工程で追加します</span><p>回収開始は任意とし、開始記録がなくても作業結果を登録できる設計です。</p></div></>
}

function Detail({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div> }
function reservationFor(reservations: Reservation[], assignment: DispatchAssignment) { return reservations.find((item) => item.reservationId === assignment.reservationId) }
function categoryName(reservation: Reservation) { return categories.find((item) => item.id === reservation.categoryId)?.name ?? reservation.categoryId }
function answerValue(reservation: Reservation) { return reservation.categoryId === 'keikoukan' ? `おおよそ${String(reservation.categoryAnswers.approximateTubeCount)}本` : String(reservation.categoryAnswers[reservation.categoryId === 'kagu' ? 'itemsAndQuantities' : 'typesAndQuantities']) }
function addDays(value: string, amount: number) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10) }
