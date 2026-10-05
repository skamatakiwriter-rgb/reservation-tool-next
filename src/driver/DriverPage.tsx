import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { categories, driverName, driverReviewRequired, snapshotDispatchForDriver, todayInJapan, vehicleName, type DemoSnapshot, type DispatchAssignment, type DriverReassignmentEvent, type Reservation } from '../domain'
import { formatDate } from '../reserve/format'
import { demoRepository, useDemoData } from '../reserve/useDemoData'
import { publishDemoChange } from '../reserve/demoSync'
import { CollectionOutcomeDialog, type CollectionOutcomeInput } from '../dispatch/CollectionOutcomeDialog'
import { dispatchChangeHistory, driverReservationReviewFields, type DispatchChangeHistoryItem, type DispatchReviewField, type DispatchReviewFieldKey } from '../dispatch/dispatchReviewPresentation'
import { PageHelp } from '../guide/PageHelp'
import './DriverPage.css'
import './DriverChangeHistory.css'
import '../dispatch/DriverReview.css'

const dispatchLabels = { assigned: '配車済み', inProgress: '回収中', completed: '作業終了', cancelled: '配車取消' } as const

export function DriverPage() {
  const { snapshot, loading, error, refresh } = useDemoData('driver')
  const [driverId, setDriverId] = useState('')
  const today = todayInJapan()
  const [rangePreset, setRangePreset] = useState<'today' | 'tomorrow' | 'sevenDays' | 'custom'>('today')
  const [fromDate, setFromDate] = useState(today)
  const [toDate, setToDate] = useState(today)
  const [selectedDispatchId, setSelectedDispatchId] = useState<string>()
  const [message, setMessage] = useState<string>()
  const assignments = useMemo(() => {
    if (!snapshot || !driverId) return []
    return snapshot.dispatchAssignments.filter((item) => item.primaryDriverId === driverId && item.plannedDate >= fromDate && item.plannedDate <= toDate && (item.status === 'assigned' || item.status === 'inProgress')).sort((a, b) => a.plannedDate.localeCompare(b.plannedDate) || a.plannedStartTime.localeCompare(b.plannedStartTime) || (reservationFor(snapshot.reservations, a)?.reservationCode ?? '').localeCompare(reservationFor(snapshot.reservations, b)?.reservationCode ?? ''))
  }, [driverId, fromDate, snapshot, toDate])
  const assignmentsByDate = useMemo(() => assignments.reduce((groups, assignment) => {
    const group = groups.get(assignment.plannedDate) ?? []
    group.push(assignment)
    groups.set(assignment.plannedDate, group)
    return groups
  }, new Map<string, DispatchAssignment[]>()), [assignments])
  const selected = assignments.find((item) => item.dispatchId === selectedDispatchId)
  const selectedReservation = selected && snapshot ? reservationFor(snapshot.reservations, selected) : undefined
  const reassignmentEntries = useMemo(() => {
    if (!snapshot || !driverId) return []
    return snapshot.dispatchAssignments.flatMap((assignment) => (assignment.driverReassignmentHistory ?? [])
      .map((event, eventIndex) => ({ assignment, event, eventIndex, reservation: reservationFor(snapshot.reservations, assignment) }))
      .filter((entry) => {
        const removedFromDriver = entry.event.before.primaryDriverId === driverId
        const assignedToDriver = entry.event.after.primaryDriverId === driverId
        const relevantDate = removedFromDriver ? entry.event.before.plannedDate : entry.event.after.plannedDate
        return (removedFromDriver || assignedToDriver) && relevantDate >= fromDate && relevantDate <= toDate
      }))
      .filter((entry): entry is DriverReassignmentEntry => Boolean(entry.reservation))
      .sort((a, b) => b.event.changedAt.localeCompare(a.event.changedAt) || b.eventIndex - a.eventIndex)
  }, [driverId, fromDate, snapshot, toDate])

  if (loading) return <div className="page driver-page"><p className="driver-loading">担当データを読み込んでいます…</p></div>
  if (error || !snapshot?.metadata) return <div className="page driver-page"><div className="error-summary" role="alert">{error ?? '担当データを読み込めませんでした。'}</div></div>
  const activeDrivers = snapshot.drivers.filter((item) => item.isActive)
  const selectedDriver = activeDrivers.find((item) => item.driverId === driverId)
  const selectRange = (preset: 'today' | 'tomorrow' | 'sevenDays') => {
    setRangePreset(preset)
    const start = preset === 'tomorrow' ? addDays(today, 1) : today
    setFromDate(start)
    setToDate(preset === 'sevenDays' ? addDays(today, 6) : start)
    setSelectedDispatchId(undefined)
  }
  const changeFromDate = (value: string) => {
    setFromDate(value)
    if (toDate < value || toDate > addDays(value, 30)) setToDate(value)
    setSelectedDispatchId(undefined)
  }
  const rangeTitle = fromDate === toDate ? `${formatDate(fromDate)}の担当` : `${formatDate(fromDate)}～${formatDate(toDate)}の担当`

  return <div className="driver-page">
    <header className="driver-hero"><div><span className="driver-mode-badge">公開デモ版</span><h1>ドライバー担当画面</h1><p>担当案件と現場で必要な情報をスマートフォンから確認する想定の画面です。</p></div><Link to="/">デモ入口へ戻る</Link></header>
    <div className="driver-content">
      {message && <div className="driver-message" role="status">{message}<button type="button" aria-label="お知らせを閉じる" onClick={() => setMessage(undefined)}>×</button></div>}
      <div className="driver-demo-notice" role="note"><strong>デモ用の担当者選択です</strong><span>本番のログイン・本人確認を再現するものではありません。</span></div>
      <PageHelp title="この画面の使い方" anchor="driver" steps={['架空ドライバーを選びます。', '今日、明日、今後7日、または任意期間を選びます。', '「担当変更のお知らせ」がある場合は、現在自分が担当か、担当から外れたかを確認します。', '赤い「要確認」がある案件は、変更前と現在の内容を確認して「変更内容を確認しました」を押します。', '必要に応じて回収開始または作業結果を登録します。']} />
      <section className="driver-controls" aria-label="担当者と表示期間"><label>架空ドライバー<select value={driverId} onChange={(event) => { setDriverId(event.target.value); setSelectedDispatchId(undefined) }}><option value="">選択してください</option>{activeDrivers.map((driver) => <option value={driver.driverId} key={driver.driverId}>{driverName(driver)}</option>)}</select></label><div className="driver-range-controls" aria-label="表示期間"><div className="driver-range-presets"><button type="button" aria-pressed={rangePreset === 'today'} onClick={() => selectRange('today')}>今日</button><button type="button" aria-pressed={rangePreset === 'tomorrow'} onClick={() => selectRange('tomorrow')}>明日</button><button type="button" aria-pressed={rangePreset === 'sevenDays'} onClick={() => selectRange('sevenDays')}>今後7日</button><button type="button" aria-pressed={rangePreset === 'custom'} onClick={() => setRangePreset('custom')}>期間を指定</button></div>{rangePreset === 'custom' && <div className="driver-custom-range"><label>開始日<input type="date" value={fromDate} onChange={(event) => changeFromDate(event.target.value)} /></label><span aria-hidden="true">～</span><label>終了日<input type="date" min={fromDate} max={addDays(fromDate, 30)} value={toDate} onChange={(event) => { setToDate(event.target.value); setSelectedDispatchId(undefined) }} /></label></div>}<small>指定できる期間は最大31日です。</small></div></section>
      {toDate > today && <p className="driver-future-notice">今後の予定は、配車変更により更新される場合があります。</p>}
      {!selectedDriver ? <section className="driver-empty"><h2>担当ドライバーを選択してください</h2><p>選択すると、指定期間の担当案件が日付・予定時刻順に表示されます。</p></section> : <><DriverReassignmentNotices entries={reassignmentEntries} driverId={driverId} snapshot={snapshot} onRefresh={refresh} onMessage={setMessage} /><div className="driver-layout">
        <section className="driver-list" aria-label={`${driverName(selectedDriver)}の担当案件`}><header><div><span>{driverName(selectedDriver)}</span><h2>{rangeTitle}</h2></div><strong>{assignments.length}件</strong></header>{assignments.length === 0 ? <p className="driver-empty-list">この期間の担当案件はありません。</p> : Array.from(assignmentsByDate, ([plannedDate, dailyAssignments]) => { const pendingCount = dailyAssignments.filter(driverReviewRequired).length; return <section className={`driver-day-group ${plannedDate === today ? 'today' : ''}`} key={plannedDate}><h3>{formatDate(plannedDate)}{plannedDate === today ? '・今日' : ''}<span>{dailyAssignments.length}件</span>{pendingCount > 0 && <span className="driver-day-review-count">要確認 {pendingCount}件</span>}</h3>{dailyAssignments.map((assignment) => {
          const reservation = reservationFor(snapshot.reservations, assignment); const vehicle = snapshot.vehicles.find((item) => item.vehicleId === assignment.vehicleId); if (!reservation) return null
          const reviewPending = driverReviewRequired(assignment)
          const reassignedBack = assignment.driverReassignmentHistory?.some((event) => event.before.primaryDriverId === assignment.primaryDriverId)
          return <button type="button" className={`driver-job ${selectedDispatchId === assignment.dispatchId ? 'selected' : ''} ${reviewPending ? 'driver-review-pending' : ''}`} key={assignment.dispatchId} onClick={() => setSelectedDispatchId(assignment.dispatchId)}><span className="driver-time">{assignment.plannedStartTime}–{assignment.plannedEndTime}</span><span className="driver-job-main"><strong>{reservation.companyName}</strong><small>{categoryName(reservation)}・{reservation.reservationCode}</small><small>{reservation.address || '指定回収先なし'}</small></span><span className={`dispatch-chip ${assignment.status}`}>{dispatchLabels[assignment.status]}</span>{reassignedBack && <span className="driver-reassigned-list-badge">再担当</span>}{reviewPending && <span className="driver-review-list-badge">要確認</span>}{vehicle?.loadHold && <span className="driver-warning danger">車両保留中</span>}</button>
        })}</section> })}</section>
        <section className="driver-detail" aria-live="polite">{selected && selectedReservation ? <DriverAssignmentDetail assignment={selected} reservation={selectedReservation} snapshot={snapshot} onRefresh={refresh} onMessage={setMessage} onCompleted={() => setSelectedDispatchId(undefined)} /> : <div className="driver-detail-empty"><h2>案件を選択してください</h2><p>依頼時申告、連絡事項、ドライバー向け指示を確認できます。</p></div>}</section>
      </div></>}
    </div>
  </div>
}

type DriverReassignmentEntry = { assignment: DispatchAssignment; event: DriverReassignmentEvent; eventIndex: number; reservation: Reservation }

function DriverReassignmentNotices({ entries, driverId, snapshot, onRefresh, onMessage }: { entries: DriverReassignmentEntry[]; driverId: string; snapshot: DemoSnapshot; onRefresh: () => Promise<void>; onMessage: (message: string) => void }) {
  const [acknowledgingId, setAcknowledgingId] = useState<string>()
  const [error, setError] = useState<string>()
  if (entries.length === 0) return null
  const currentNoticeByDispatch = new Map<string, DriverReassignmentEntry>()
  entries.forEach((entry) => {
    if (entry.event.before.primaryDriverId === driverId && entry.assignment.primaryDriverId !== driverId && !currentNoticeByDispatch.has(entry.assignment.dispatchId)) currentNoticeByDispatch.set(entry.assignment.dispatchId, entry)
  })
  const pending = Array.from(currentNoticeByDispatch.values()).filter((entry) => !entry.event.acknowledgedAt)
  const pendingIds = new Set(pending.map((entry) => entry.event.changeId))
  const history = entries.filter((entry) => !pendingIds.has(entry.event.changeId))
  const acknowledge = async (entry: DriverReassignmentEntry) => {
    setAcknowledgingId(entry.event.changeId); setError(undefined)
    const result = await demoRepository.acknowledgeDriverReassignment({ generationId: snapshot.metadata!.generationId, idempotencyKey: crypto.randomUUID(), actor: `demo-driver:${driverId}`, reservationId: entry.reservation.reservationId, expectedReservationVersion: entry.reservation.version, dispatchId: entry.assignment.dispatchId, expectedDispatchVersion: entry.assignment.version, changeId: entry.event.changeId })
    if (result.kind === 'success' || result.kind === 'duplicateSuccess') { publishDemoChange('dispatch', entry.assignment.dispatchId); await onRefresh(); onMessage('担当変更を確認済みにしました。') }
    else setError(driverResultMessage(result))
    setAcknowledgingId(undefined)
  }
  const content = (entry: DriverReassignmentEntry, showButton: boolean) => {
    const previousDriver = snapshot.drivers.find((item) => item.driverId === entry.event.before.primaryDriverId)
    const nextDriver = snapshot.drivers.find((item) => item.driverId === entry.event.after.primaryDriverId)
    const currentDriver = snapshot.drivers.find((item) => item.driverId === entry.assignment.primaryDriverId)
    const isCurrentAssignmentEvent = entry.assignment.primaryDriverId === driverId && entry.event.after.primaryDriverId === driverId && entry.eventIndex === (entry.assignment.driverReassignmentHistory?.length ?? 0) - 1
    const wasAssignedEarlier = (entry.assignment.driverReassignmentHistory ?? []).slice(0, entry.eventIndex).some((event) => event.before.primaryDriverId === driverId || event.after.primaryDriverId === driverId)
    const removedFromDriver = entry.event.before.primaryDriverId === driverId
    const scheduleChanged = entry.event.before.plannedDate !== entry.event.after.plannedDate || entry.event.before.plannedStartTime !== entry.event.after.plannedStartTime || entry.event.before.plannedEndTime !== entry.event.after.plannedEndTime
    const title = isCurrentAssignmentEvent ? `${entry.reservation.reservationCode}は${driverName(previousDriver)}から、${wasAssignedEarlier ? '再び' : ''}あなたの担当になりました` : showButton ? `${entry.reservation.reservationCode}は、あなたの担当から外れました` : `${entry.reservation.reservationCode}の担当変更履歴`
    const schedule = isCurrentAssignmentEvent ? `${formatDate(entry.assignment.plannedDate)} ${entry.assignment.plannedStartTime}–${entry.assignment.plannedEndTime}` : `${formatDate(entry.event.before.plannedDate)} ${entry.event.before.plannedStartTime}–${entry.event.before.plannedEndTime}`
    return <article className={showButton ? 'pending' : 'acknowledged'} key={entry.event.changeId}><div><strong>{title}</strong><span>{entry.reservation.companyName}</span><span>{isCurrentAssignmentEvent ? '現在の予定' : '変更前の予定'}：{schedule}</span>{showButton ? <span>現在の担当：{driverName(currentDriver)}</span> : <span>担当変更時：{driverName(previousDriver)} → {driverName(nextDriver)}</span>}{!isCurrentAssignmentEvent && scheduleChanged && <span>変更後の予定：{formatDate(entry.event.after.plannedDate)} {entry.event.after.plannedStartTime}–{entry.event.after.plannedEndTime}</span>}<small>変更：{formatDateTime(entry.event.changedAt)}</small>{entry.event.acknowledgedAt ? <small>確認：{formatDateTime(entry.event.acknowledgedAt)}</small> : !showButton && removedFromDriver && <small>後続の担当変更により、確認対象ではなくなりました。</small>}</div>{showButton && <button type="button" disabled={Boolean(acknowledgingId)} onClick={() => acknowledge(entry)}>{acknowledgingId === entry.event.changeId ? '保存中…' : '担当変更を確認しました'}</button>}</article>
  }
  return <section className={`driver-reassignment-notices ${pending.length > 0 ? 'has-pending' : ''}`} aria-label="担当変更のお知らせ"><header><div><span>担当変更</span><h2>{pending.length > 0 ? '担当変更のお知らせ' : '担当変更履歴'}</h2></div>{pending.length > 0 && <strong>未確認 {pending.length}件</strong>}</header>{error && <div className="error-summary" role="alert">{error}</div>}{pending.map((entry) => content(entry, true))}{history.length > 0 && <details><summary>担当変更履歴（{history.length}件）</summary>{history.map((entry) => content(entry, false))}</details>}</section>
}

function DriverAssignmentDetail({ assignment, reservation, snapshot, onRefresh, onMessage, onCompleted }: { assignment: DispatchAssignment; reservation: Reservation; snapshot: DemoSnapshot; onRefresh: () => Promise<void>; onMessage: (message: string) => void; onCompleted: () => void }) {
  const vehicle = snapshot.vehicles.find((item) => item.vehicleId === assignment.vehicleId)
  const driver = snapshot.drivers.find((item) => item.driverId === assignment.primaryDriverId)
  const [outcomeOpen, setOutcomeOpen] = useState(false)
  const [actionError, setActionError] = useState<string>()
  const [starting, setStarting] = useState(false)
  const [acknowledging, setAcknowledging] = useState(false)
  const actor = `demo-driver:${assignment.primaryDriverId}` as const
  const blockedByVehicle = Boolean(vehicle?.loadHold)
  const reviewPending = driverReviewRequired(assignment)
  const reassignedBack = assignment.driverReassignmentHistory?.some((event) => event.before.primaryDriverId === assignment.primaryDriverId)
  const reviewFields = reviewPending ? driverReservationReviewFields(reservation, assignment) : []
  const changeHistory = dispatchChangeHistory(reservation, assignment)
  const reviewField = (key: DispatchReviewFieldKey) => reviewFields.find((item) => item.key === key)
  const dispatchBaseline = assignment.driverDispatchSnapshotAtLastAcknowledgement ?? snapshotDispatchForDriver(assignment)
  const currentSchedule = `${formatDate(assignment.plannedDate)} ${assignment.plannedStartTime}–${assignment.plannedEndTime}`
  const previousSchedule = `${formatDate(dispatchBaseline.plannedDate)} ${dispatchBaseline.plannedStartTime}–${dispatchBaseline.plannedEndTime}`
  const scheduleChange = reviewPending && previousSchedule !== currentSchedule ? makeReviewField('plannedSchedule', '予定日時', previousSchedule, currentSchedule) : undefined
  const previousVehicle = snapshot.vehicles.find((item) => item.vehicleId === dispatchBaseline.vehicleId)
  const vehicleChange = reviewPending && dispatchBaseline.vehicleId !== assignment.vehicleId ? makeReviewField('vehicle', '担当車両', vehicleName(previousVehicle), vehicle ? vehicleName(vehicle) : '車両情報なし') : undefined
  const previousInstructions = dispatchBaseline.driverInstructions || '指示はありません。'
  const currentInstructions = assignment.driverInstructions || '指示はありません。'
  const instructionChange = reviewPending && previousInstructions !== currentInstructions ? makeReviewField('driverInstructions', 'ドライバー向け指示', previousInstructions, currentInstructions) : undefined
  const acknowledge = async () => {
    setAcknowledging(true); setActionError(undefined)
    const result = await demoRepository.acknowledgeDriverReview({ generationId: snapshot.metadata!.generationId, idempotencyKey: crypto.randomUUID(), actor, reservationId: reservation.reservationId, expectedReservationVersion: reservation.version, dispatchId: assignment.dispatchId, expectedDispatchVersion: assignment.version })
    if (result.kind === 'success' || result.kind === 'duplicateSuccess') { publishDemoChange('dispatch', assignment.dispatchId); await onRefresh(); onMessage('変更内容を確認済みにしました。') }
    else setActionError(driverResultMessage(result))
    setAcknowledging(false)
  }
  const start = async () => {
    if (!window.confirm(`${reservation.reservationCode}の回収開始を記録します。開始後は通常の配車変更ができません。`)) return
    setStarting(true); setActionError(undefined)
    const result = await demoRepository.startDispatch({ generationId: snapshot.metadata!.generationId, idempotencyKey: crypto.randomUUID(), actor, reservationId: reservation.reservationId, expectedReservationVersion: reservation.version, dispatchId: assignment.dispatchId, expectedDispatchVersion: assignment.version })
    if (result.kind === 'success' || result.kind === 'duplicateSuccess') { publishDemoChange('dispatchStatus', assignment.dispatchId); await onRefresh(); onMessage('回収開始を記録しました。') }
    else setActionError(driverResultMessage(result))
    setStarting(false)
  }
  const complete = async (input: CollectionOutcomeInput) => {
    const result = await demoRepository.completeDispatch({ generationId: snapshot.metadata!.generationId, idempotencyKey: crypto.randomUUID(), actor, reservationId: reservation.reservationId, expectedReservationVersion: reservation.version, dispatchId: assignment.dispatchId, expectedDispatchVersion: assignment.version, outcome: input.outcome, actualCollectionSummary: input.actualCollectionSummary, outcomeNotes: input.outcomeNotes })
    if (result.kind !== 'success' && result.kind !== 'duplicateSuccess') return driverResultMessage(result)
    publishDemoChange('dispatchStatus', assignment.dispatchId); setOutcomeOpen(false); await onRefresh(); onMessage(collectionOutcomeMessage(input.outcome)); onCompleted(); return undefined
  }
  const requestedDateChange = reviewField('requestedDate')
  const answerChange = reviewField('categoryAnswers')
  const contactNotesChange = reviewField('contactNotes')
  return <>
    <div className="driver-detail-heading"><div><span>{reservation.reservationCode}</span><h2>{reservation.companyName}</h2></div><span className={`dispatch-chip ${assignment.status}`}>{dispatchLabels[assignment.status]}</span></div>
    {actionError && <div className="error-summary" role="alert">{actionError}</div>}
    {reviewPending && <div className="driver-alert"><strong>{reassignedBack ? '再びこの案件の担当になりました' : '予約・配車内容が変更されています'}</strong><span>赤い「要確認」が付いた項目を確認し、下の確認ボタンを押してください。</span></div>}
    {vehicle?.loadHold && <div className="driver-alert danger"><strong>{vehicleName(vehicle)}は{vehicle.loadHold.status === 'decisionPending' ? '搬入判断待ち' : '積み置き中'}です</strong><span>この画面では変更せず、配車担当者へ連絡してください。</span></div>}
    <dl className="driver-detail-grid"><Detail label="予定日時" value={currentSchedule} reviewChange={scheduleChange} />{requestedDateChange && <Detail label="予約希望日" value={formatDate(reservation.requestedDate)} reviewChange={requestedDateChange} />}<Detail label="担当車両" value={vehicle ? vehicleName(vehicle) : '車両情報なし'} reviewChange={vehicleChange} /><Detail label="担当者" value={reservation.contactName} /><Detail label="電話番号" value={reservation.phoneDisplay} /><Detail label="回収先" value={reservation.address || '指定回収先なし'} reviewChange={reviewField('address')} /><Detail label="カテゴリー" value={categoryName(reservation)} />{assignment.startedAt && <Detail label="回収開始" value={formatDateTime(assignment.startedAt)} />}</dl>
    <ReviewInformation title="依頼時申告・目安" value={answerValue(reservation)} reviewChange={answerChange}><small>依頼者から受付時に申告された内容です。実際の回収量と異なる場合があります。</small></ReviewInformation>
    <ReviewInformation title="顧客からの連絡事項" value={reservation.contactNotes || 'なし'} reviewChange={contactNotesChange} />
    <ReviewInformation title="ドライバー向け指示" value={currentInstructions} reviewChange={instructionChange} />
    {reviewPending && <section id="driver-change-confirm" className="driver-review-confirm"><strong>現在の内容を確認してください</strong><p>上に表示されている予定日時、回収先、依頼内容、連絡事項、車両、指示を確認してから押してください。</p><button type="button" disabled={acknowledging} onClick={acknowledge}>{acknowledging ? '保存中…' : '変更内容を確認しました'}</button></section>}
    {changeHistory.length > 0 && <DriverChangeHistory changes={changeHistory} pending={reviewPending} />}
    <div className="driver-work-actions">{assignment.status === 'assigned' && <button type="button" disabled={starting || blockedByVehicle || reviewPending} onClick={start}>{starting ? '記録中…' : '回収開始を記録'}</button>}<button type="button" disabled={blockedByVehicle || reviewPending} onClick={() => setOutcomeOpen(true)}>作業結果を登録</button>{reviewPending && <p className="driver-review-action-help">先に変更内容を確認してください。</p>}{assignment.status === 'assigned' && <p>開始記録は任意です。記録しなくても作業結果を登録できます。</p>}<p>同日・同じ車両・同じ主担当ドライバーで回収を続ける場合は、ここでは何も操作しません。</p></div>
    {outcomeOpen && <CollectionOutcomeDialog reservation={reservation} assignment={assignment} vehicleName={vehicleName(vehicle)} driverName={driverName(driver)} allowVehicleHold={false} onClose={() => setOutcomeOpen(false)} onSubmit={complete} />}
  </>
}

function Detail({ label, value, reviewChange }: { label: string; value: string; reviewChange?: DispatchReviewField }) { return <div className={reviewChange ? 'driver-review-field' : ''}><dt>{label}{reviewChange && <ReviewBadge />}</dt>{reviewChange ? <ReviewComparison change={reviewChange} /> : <dd>{value}</dd>}</div> }
function ReviewInformation({ title, value, reviewChange, children }: { title: string; value: string; reviewChange?: DispatchReviewField; children?: ReactNode }) { return <section className={`driver-information ${reviewChange ? 'driver-review-field' : ''}`}><h3>{title}{reviewChange && <ReviewBadge />}</h3>{reviewChange ? <ReviewComparison change={reviewChange} /> : <p>{value}</p>}{children}</section> }
function ReviewBadge() { return <span className="driver-review-badge">要確認</span> }
function ReviewComparison({ change }: { change: DispatchReviewField }) { return <div className="driver-review-comparison"><span>変更前：<s>{change.before}</s></span><strong>現在：{change.after}</strong></div> }
function makeReviewField(key: DispatchReviewFieldKey, label: string, before: string, after: string): DispatchReviewField { return { key, label, before, after, text: `${label}：${before} → ${after}` } }
function DriverChangeHistory({ changes, pending }: { changes: DispatchChangeHistoryItem[]; pending: boolean }) { return <section className="driver-change-history" aria-label="配車後の変更履歴"><div className="driver-change-history-heading"><div><h3>配車後の変更履歴</h3><p>{pending ? '未確認の変更があります。現在の内容とあわせて確認してください。' : '確認後も、変更履歴は残ります。'}</p></div><span>{changes.length}件</span></div>{changes.map((change, index) => <details className="driver-change-event" key={change.changeId} open={index === 0}><summary><strong>{index === 0 ? '最新の変更' : `${changes.length - index}件目の変更`}</strong><span>{formatDateTime(change.changedAt)}</span></summary><dl>{change.fields.map((field) => <div key={field.key}><dt>{field.label}</dt><dd><span>{field.before}</span><b aria-hidden="true">→</b><strong>{field.after}</strong></dd></div>)}</dl></details>)}</section> }
function reservationFor(reservations: Reservation[], assignment: DispatchAssignment) { return reservations.find((item) => item.reservationId === assignment.reservationId) }
function categoryName(reservation: Reservation) { return categories.find((item) => item.id === reservation.categoryId)?.name ?? reservation.categoryId }
function answerValue(reservation: Reservation) { return reservation.categoryId === 'keikoukan' ? `おおよそ${String(reservation.categoryAnswers.approximateTubeCount)}本` : String(reservation.categoryAnswers[reservation.categoryId === 'kagu' ? 'itemsAndQuantities' : 'typesAndQuantities']) }
function addDays(value: string, amount: number) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10) }
function formatDateTime(value: string) { return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) }
function collectionOutcomeMessage(outcome: CollectionOutcomeInput['outcome']) { return outcome === 'allCollected' ? '全量回収として作業を終了し、予約を完了しました。' : outcome === 'partiallyCollected' ? '一部回収として作業を終了しました。予約一覧で要再配車と表示されます。' : '回収できずとして作業を終了しました。予約一覧で要対応と表示されます。' }
function driverResultMessage(result: Awaited<ReturnType<typeof demoRepository.startDispatch>>) { if (result.kind === 'validationError') return result.errors[0]?.message ?? '入力内容を確認してください。'; const messages: Record<string,string> = { versionConflict: '予約内容が更新されています。画面を再読み込みしてください。', dispatchVersionConflict: '配車内容が更新されています。画面を再読み込みしてください。', invalidDispatchTransition: '現在の配車状態では操作できません。', vehicleOnHold: '担当車両が保留中です。配車担当者へ連絡してください。', vehicleUnavailable: '担当車両を使用できません。配車担当者へ連絡してください。', staleGeneration: 'デモデータが初期化されました。画面を再読み込みしてください。' }; return messages[result.kind] ?? '処理を完了できませんでした。' }
