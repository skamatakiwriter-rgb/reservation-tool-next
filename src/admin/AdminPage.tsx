import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  categories,
  countReservationsForCapacity,
  normalizePhoneNumber,
  todayInJapan,
  validateReservationInput,
  type CategoryId,
  type DemoSnapshot,
  type Reservation,
  type ReservationInput,
  type ReservationStatus,
  type SaveResult,
} from '../domain'
import { formatDate } from '../reserve/format'
import { demoRepository, useDemoData } from '../reserve/useDemoData'
import { publishDemoChange } from '../reserve/demoSync'

type View = 'calendar' | 'list'
type CalendarCategoryId = '' | CategoryId
type EditorState = { mode: 'create' | 'edit' | 'related'; reservation?: Reservation; contactSource?: Reservation; defaultDate?: string; defaultCategory?: CategoryId }
type ListFilters = { query: string; category: '' | CategoryId; status: '' | ReservationStatus | 'unfinished'; from: string; to: string }

const statusLabels: Record<ReservationStatus, string> = { received: '受付', confirmed: '確定', completed: '完了', cancelled: '取消' }
const activeStatuses = new Set<ReservationStatus>(['received', 'confirmed', 'completed'])

export function AdminPage() {
  const [active, setActive] = useState(() => sessionStorage.getItem('reservation-demo-admin') === 'active')
  if (!active) return <AdminWelcome onStart={() => { sessionStorage.setItem('reservation-demo-admin', 'active'); setActive(true) }} />
  return <AdminWorkspace onExit={() => { sessionStorage.removeItem('reservation-demo-admin'); setActive(false) }} />
}

function AdminWelcome({ onStart }: { onStart: () => void }) {
  return (
    <div className="page admin-welcome">
      <header className="page-intro"><span className="eyebrow blue-text">For Demo Administrators</span><h1>管理者用 予約管理</h1><p>予約状況の確認から電話受付、状態変更、受付設定までを体験できます。</p></header>
      <section className="admin-guide-card">
        <span className="admin-mode-badge">公開デモ版</span><h2>管理者デモを開始します</h2>
        <p>パスワードは不要です。この画面で扱う予約は、すべて架空のデモデータです。</p>
        <ul><li>変更内容はこのブラウザ内だけに保存されます。</li><li>実在する会社名・氏名・住所・電話番号は入力しないでください。</li><li>デモ終了時はデータを残すか、削除するかを選べます。</li></ul>
        <button className="button admin-primary" type="button" onClick={onStart}>管理画面を試す</button>
      </section>
    </div>
  )
}

function AdminWorkspace({ onExit }: { onExit: () => void }) {
  const { snapshot, loading, error, refresh } = useDemoData()
  const today = todayInJapan()
  const [view, setView] = useState<View>('calendar')
  const [categoryId, setCategoryId] = useState<CalendarCategoryId>('')
  const [month, setMonth] = useState(today.slice(0, 7))
  const [selectedDate, setSelectedDate] = useState(today)
  const [selectedReservationId, setSelectedReservationId] = useState<string>()
  const [editor, setEditor] = useState<EditorState>()
  const [message, setMessage] = useState<string>()
  const [filters, setFilters] = useState<ListFilters>(() => ({ query: '', category: '', status: '', from: `${today.slice(0, 7)}-01`, to: monthEnd(today.slice(0, 7)) }))
  const selectedReservation = snapshot?.reservations.find((item) => item.reservationId === selectedReservationId)

  useEffect(() => {
    if (snapshot?.metadata?.lifecycleState === 'deleted') onExit()
  }, [snapshot?.metadata?.lifecycleState, onExit])

  if (loading) return <AdminLoading />
  if (error || !snapshot?.metadata) return <div className="page admin-page"><div className="error-summary" role="alert">{error ?? '管理データを読み込めませんでした。'}</div></div>

  const reset = async () => {
    if (!window.confirm('このブラウザ内の変更を消去し、架空の初期予約9件へ戻します。よろしいですか？')) return
    const response = await demoRepository.resetDemoData(snapshot.metadata!.generationId)
    if (response.kind === 'success' || response.kind === 'duplicateSuccess') publishDemoChange('reset')
    setMessage(resultMessage(response, '初期状態に戻しました。'))
    await refresh()
  }
  const deleteAndExit = async () => {
    if (!window.confirm('このブラウザ内の予約、設定、履歴を削除して管理者デモを終了します。よろしいですか？')) return
    const response = await demoRepository.deleteDemoData(snapshot.metadata!.generationId)
    if (response.kind === 'success') { publishDemoChange('deleted'); onExit() }
    else setMessage(resultMessage(response, ''))
  }
  const openPastIncomplete = () => {
    setFilters({ query: '', category: '', status: 'unfinished', from: '', to: previousDate(today) })
    setView('list')
  }

  return (
    <div className="admin-page">
      <header className="admin-toolbar">
        <div><span className="admin-mode-badge">デモ管理者モード</span><h1>予約管理</h1></div>
        <div className="admin-toolbar-actions"><button type="button" onClick={reset}>初期状態に戻す</button><button type="button" onClick={onExit}>デモを終了する</button><button type="button" className="danger-link" onClick={deleteAndExit}>データを削除して終了</button></div>
      </header>
      <div className="admin-content">
        {message && <div className="admin-message" role="status">{message}<button type="button" aria-label="お知らせを閉じる" onClick={() => setMessage(undefined)}>×</button></div>}
        <SummaryCards snapshot={snapshot} month={today.slice(0, 7)} today={today} onPastIncomplete={openPastIncomplete} />
        <nav className="admin-tabs" aria-label="管理画面の表示切替"><button className={view === 'calendar' ? 'active' : ''} type="button" onClick={() => setView('calendar')}>カレンダー</button><button className={view === 'list' ? 'active' : ''} type="button" onClick={() => setView('list')}>予約一覧</button></nav>
        {view === 'calendar' ? (
          <AdminCalendar snapshot={snapshot} categoryId={categoryId} month={month} selectedDate={selectedDate} today={today} onCategory={setCategoryId} onMonth={setMonth} onDate={setSelectedDate} onReservation={(reservation) => setSelectedReservationId(reservation.reservationId)} onCreate={() => setEditor({ mode: 'create', defaultDate: selectedDate, defaultCategory: categoryId || undefined })} onRefresh={refresh} onMessage={setMessage} />
        ) : (
          <ReservationList snapshot={snapshot} filters={filters} onFilters={setFilters} onOpen={(reservation) => setSelectedReservationId(reservation.reservationId)} />
        )}
      </div>
      {selectedReservation && <ReservationDetail reservation={selectedReservation} snapshot={snapshot} onClose={() => setSelectedReservationId(undefined)} onEdit={(reservation) => { setSelectedReservationId(undefined); setEditor({ mode: 'edit', reservation }) }} onRelated={(reservation) => { setSelectedReservationId(undefined); setEditor({ mode: 'related', reservation }) }} onReuse={(reservation) => { setSelectedReservationId(undefined); setEditor({ mode: 'create', contactSource: reservation }) }} onRefresh={async () => { await refresh(); setSelectedReservationId(undefined) }} onMessage={setMessage} />}
      {editor && <AdminReservationEditor state={editor} snapshot={snapshot} onClose={() => setEditor(undefined)} onSaved={async (text) => { setEditor(undefined); setMessage(text); await refresh() }} />}
    </div>
  )
}

function AdminLoading() { return <div className="page admin-page"><p className="admin-loading">管理データを読み込んでいます…</p></div> }

function SummaryCards({ snapshot, month, today, onPastIncomplete }: { snapshot: DemoSnapshot; month: string; today: string; onPastIncomplete: () => void }) {
  const inMonth = snapshot.reservations.filter((item) => item.requestedDate.startsWith(month))
  const received = inMonth.filter((item) => item.status === 'received').length
  const confirmed = inMonth.filter((item) => item.status === 'confirmed').length
  const closures = snapshot.closures.filter((item) => item.isClosed && item.date.startsWith(month)).length
  const overCapacity = countOverCapacity(snapshot, month)
  const incomplete = snapshot.reservations.filter((item) => item.requestedDate < today && (item.status === 'received' || item.status === 'confirmed')).length
  return <><section className="summary-cards" aria-label="今月の予約状況"><Metric label="受付件数" value={received} note="当月・全カテゴリー" tone="blue" /><Metric label="確定件数" value={confirmed} note="当月・全カテゴリー" tone="green" /><Metric label="受付停止" value={closures} note="当月の日付・カテゴリー組" tone="amber" /><Metric label="上限超過" value={overCapacity} note="当月の日付・カテゴリー組" tone="red" /></section>{incomplete > 0 && <button type="button" className="incomplete-alert" onClick={onPastIncomplete}><strong>予約日を過ぎた未完了の予約が{incomplete}件あります</strong><span>予約一覧で確認する →</span></button>}</>
}

function Metric({ label, value, note, tone }: { label: string; value: number; note: string; tone: string }) { return <article className={`metric ${tone}`}><span>{label}</span><strong>{value}<small>件</small></strong><p>{note}</p></article> }

type CalendarProps = { snapshot: DemoSnapshot; categoryId: CalendarCategoryId; month: string; selectedDate: string; today: string; onCategory: (id: CalendarCategoryId) => void; onMonth: (month: string) => void; onDate: (date: string) => void; onReservation: (reservation: Reservation) => void; onCreate: () => void; onRefresh: () => Promise<void>; onMessage: (text: string) => void }

function AdminCalendar(props: CalendarProps) {
  const { snapshot, categoryId, month, selectedDate, today } = props
  const minimumMonth = addMonth(today.slice(0, 7), -12)
  const maximumMonth = addMonth(today.slice(0, 7), 12)
  const selected = snapshot.reservations.filter((item) => item.requestedDate === selectedDate && (!categoryId || item.categoryId === categoryId)).sort(sortReservations)
  const setting = categoryId ? snapshot.settings.find((item) => item.categoryId === categoryId) : undefined
  const closure = categoryId ? snapshot.closures.find((item) => item.date === selectedDate && item.categoryId === categoryId) : undefined
  const count = calendarReservationCount(snapshot.reservations, selectedDate, categoryId)
  const changeLimit = async () => {
    if (!categoryId || !setting) return
    const value = window.prompt('このカテゴリーの1日あたり上限を入力してください。0は受付停止です。', String(setting.dailyLimit))
    if (value === null) return
    const limit = Number(value)
    if (!Number.isInteger(limit) || limit < 0) { props.onMessage('上限は0以上の整数で入力してください。'); return }
    const affected = maximumDailyCount(snapshot, categoryId)
    if (limit < affected && !window.confirm(`現在の予約件数を下回ります。最大${affected}件の予約日は上限超過になります。変更しますか？`)) return
    const result = await demoRepository.updateCategoryLimit({ generationId: snapshot.metadata!.generationId, idempotencyKey: crypto.randomUUID(), actor: 'demo-admin', categoryId, expectedVersion: setting.version ?? 1, dailyLimit: limit })
    if (result.kind === 'success' || result.kind === 'duplicateSuccess') publishDemoChange('setting', categoryId)
    props.onMessage(resultMessage(result, 'カテゴリー上限を変更しました。'))
    await props.onRefresh()
  }
  const toggleClosure = async () => {
    if (!categoryId) return
    const result = await demoRepository.setClosure({ generationId: snapshot.metadata!.generationId, idempotencyKey: crypto.randomUUID(), actor: 'demo-admin', date: selectedDate, categoryId, expectedVersion: closure?.version, isClosed: !(closure?.isClosed === true) })
    if (result.kind === 'success' || result.kind === 'duplicateSuccess') publishDemoChange('closure', `${selectedDate}:${categoryId}`)
    props.onMessage(resultMessage(result, closure?.isClosed ? '受付停止を解除しました。' : 'この日の受付を停止しました。'))
    await props.onRefresh()
  }
  return (
    <section className="admin-calendar-layout">
      <div className="admin-calendar-panel">
        <div className="calendar-toolbar"><label>カテゴリー<select value={categoryId} onChange={(e) => props.onCategory(e.target.value as CalendarCategoryId)}><option value="">すべて</option>{categories.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><div><button type="button" disabled={month <= minimumMonth} onClick={() => props.onMonth(addMonth(month, -1))}>前月</button><label className="month-select">表示月<input type="month" min={minimumMonth} max={maximumMonth} value={month} onChange={(e) => props.onMonth(e.target.value)} /></label><button type="button" disabled={month >= maximumMonth} onClick={() => props.onMonth(addMonth(month, 1))}>翌月</button><button type="button" onClick={() => { props.onMonth(today.slice(0, 7)); props.onDate(today) }}>今日へ</button></div></div>
        <AdminMonthGrid snapshot={snapshot} month={month} categoryId={categoryId} selectedDate={selectedDate} onDate={props.onDate} />
      </div>
      <aside className="day-detail"><div className="day-detail-heading"><div><span>選択日</span><h2>{formatDate(selectedDate)}</h2><p>{categoryId ? categoryName(categoryId) : 'すべてのカテゴリー'}</p></div><span className={`availability-chip ${categoryId && (closure?.isClosed || Number(setting?.dailyLimit) === 0) ? 'closed' : ''}`}>{categoryId ? (closure?.isClosed || Number(setting?.dailyLimit) === 0 ? '受付停止' : `${count} / ${String(setting?.dailyLimit)}件`) : `${count}件`}</span></div>
        <div className="day-actions"><button type="button" onClick={props.onCreate}>電話受付を登録</button>{categoryId ? <><button type="button" onClick={changeLimit}>上限を変更</button><button type="button" onClick={toggleClosure}>{closure?.isClosed ? '受付停止を解除' : 'この日の受付を停止'}</button></> : <p>上限変更・受付停止はカテゴリーを選択すると操作できます。</p>}</div>
        <div className="day-reservations"><h3>この日の予約</h3>{selected.length === 0 ? <p className="empty-state">予約はありません。</p> : selected.map((item) => <button type="button" className="reservation-row" key={item.reservationId} onClick={() => props.onReservation(item)}><Status status={item.status} /><span><strong>{item.companyName}</strong><small>{categoryName(item.categoryId)}・{item.reservationCode}・{item.contactName}</small></span><b>詳細 →</b></button>)}</div>
      </aside>
    </section>
  )
}

function AdminMonthGrid({ snapshot, month, categoryId, selectedDate, onDate }: { snapshot: DemoSnapshot; month: string; categoryId: CalendarCategoryId; selectedDate: string; onDate: (date: string) => void }) {
  const cells = monthCells(month)
  return <div className="admin-month-grid" role="grid" aria-label={`${monthLabel(month)}の管理カレンダー`}>{['日','月','火','水','木','金','土'].map((day) => <span className="weekday" key={day}>{day}</span>)}{cells.map((date, index) => date ? (() => { const count = calendarReservationCount(snapshot.reservations, date, categoryId); const closed = categoryId ? snapshot.closures.some((item) => item.date === date && item.categoryId === categoryId && item.isClosed) : false; const limit = categoryId ? Number(snapshot.settings.find((item) => item.categoryId === categoryId)?.dailyLimit ?? 0) : undefined; return <button type="button" role="gridcell" className={`admin-day ${selectedDate === date ? 'selected' : ''} ${closed || limit === 0 ? 'closed' : ''} ${limit !== undefined && count > limit && limit > 0 ? 'over' : ''}`} key={date} onClick={() => onDate(date)}><span>{Number(date.slice(-2))}</span><small>{categoryId ? (closed || limit === 0 ? '停止' : `${count}/${String(limit)}件`) : `${count}件`}</small></button> })() : <span key={`blank-${index}`} />)}</div>
}

function ReservationList({ snapshot, filters, onFilters, onOpen }: { snapshot: DemoSnapshot; filters: ListFilters; onFilters: (filters: ListFilters) => void; onOpen: (reservation: Reservation) => void }) {
  const rows = snapshot.reservations.filter((item) => matchesFilters(item, filters)).sort(sortReservations)
  const update = (key: keyof ListFilters, value: string) => onFilters({ ...filters, [key]: value })
  return <section className="list-panel"><div className="list-filters"><label className="wide-filter">文字検索<input value={filters.query} placeholder="受付番号・会社名・担当者名・電話番号" onChange={(e) => update('query', e.target.value)} /></label><label>カテゴリー<select value={filters.category} onChange={(e) => update('category', e.target.value)}><option value="">すべて</option>{categories.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>状態<select value={filters.status} onChange={(e) => update('status', e.target.value)}><option value="">すべて</option><option value="unfinished">未完了（受付・確定）</option>{Object.entries(statusLabels).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>希望日開始<input type="date" value={filters.from} onChange={(e) => update('from', e.target.value)} /></label><label>希望日終了<input type="date" value={filters.to} onChange={(e) => update('to', e.target.value)} /></label></div><p className="result-count">{rows.length}件の予約</p>{rows.length === 0 ? <p className="empty-state list-empty">条件に一致する予約はありません。</p> : <div className="reservation-table-wrap"><table className="reservation-table"><thead><tr><th>受付番号</th><th>希望日</th><th>カテゴリー</th><th>状態</th><th>会社名</th><th>担当者名</th><th>電話番号</th></tr></thead><tbody>{rows.map((item) => <tr key={item.reservationId} onClick={() => onOpen(item)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(item) }}><td>{item.reservationCode}</td><td>{formatDate(item.requestedDate)}</td><td>{categoryName(item.categoryId)}</td><td><Status status={item.status} /></td><td>{item.companyName}</td><td>{item.contactName}</td><td>{item.phoneDisplay}</td></tr>)}</tbody></table></div>}</section>
}

type DetailProps = { reservation: Reservation; snapshot: DemoSnapshot; onClose: () => void; onEdit: (r: Reservation) => void; onRelated: (r: Reservation) => void; onReuse: (r: Reservation) => void; onRefresh: () => Promise<void>; onMessage: (text: string) => void }
function ReservationDetail(props: DetailProps) {
  const { reservation, snapshot } = props
  const logs = snapshot.auditLogs.filter((item) => item.entityId === reservation.reservationId).sort((a,b) => a.occurredAt.localeCompare(b.occurredAt))
  const related = snapshot.reservations.filter((item) => item.workGroupId === reservation.workGroupId && item.reservationId !== reservation.reservationId)
  const reacceptSource = reservation.sourceReservationId ? snapshot.reservations.find((item) => item.reservationId === reservation.sourceReservationId && item.status === 'cancelled') : undefined
  const reacceptedReservations = reservation.status === 'cancelled' ? snapshot.reservations.filter((item) => item.sourceReservationId === reservation.reservationId) : []
  const dialog = useDialogFocus(props.onClose)
  const transition = async (nextStatus: ReservationStatus) => {
    const reason = nextStatus === 'cancelled' ? window.prompt('取消理由があれば入力してください（任意）。', '') : undefined
    if (nextStatus === 'cancelled' && reason === null) return
    const action = statusLabels[nextStatus]
    if (!window.confirm(`${reservation.reservationCode}を「${action}」に変更します。よろしいですか？`)) return
    const result = await demoRepository.changeStatus({ generationId: snapshot.metadata!.generationId, idempotencyKey: crypto.randomUUID(), actor: 'demo-admin', reservationId: reservation.reservationId, expectedVersion: reservation.version, nextStatus, cancelReason: reason ?? undefined })
    if (result.kind === 'success' || result.kind === 'duplicateSuccess') publishDemoChange('status', reservation.reservationId)
    props.onMessage(resultMessage(result, `予約を「${action}」に変更しました。`)); await props.onRefresh()
  }
  // oxlint-disable-next-line react/refs -- The custom hook returns a stable dialog ref and keyboard handler.
  return <div className="modal-backdrop" role="presentation"><section ref={dialog.ref} tabIndex={-1} onKeyDown={dialog.onKeyDown} className="admin-modal detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title"><header><div><Status status={reservation.status} /><h2 id="detail-title">{reservation.reservationCode}</h2><p>関連番号：{reservation.workGroupCode}</p></div><button type="button" className="modal-close" aria-label="予約詳細を閉じる" onClick={props.onClose}>×</button></header><dl className="detail-grid"><Detail label="希望日" value={formatDate(reservation.requestedDate)} /><Detail label="カテゴリー" value={categoryName(reservation.categoryId)} /><Detail label="会社名" value={reservation.companyName} /><Detail label="担当者名" value={reservation.contactName} /><Detail label="電話番号" value={reservation.phoneDisplay} />{reservation.address && <Detail label="住所" value={reservation.address} />}<Detail label={answerLabel(reservation.categoryId)} value={answerValue(reservation)} /><Detail label="連絡事項" value={reservation.contactNotes || 'なし'} /></dl><div className="detail-actions">{(reservation.status === 'received' || reservation.status === 'confirmed') && <button type="button" onClick={() => props.onEdit(reservation)}>変更</button>}{reservation.status === 'received' && <button type="button" onClick={() => transition('confirmed')}>確定</button>}{reservation.status === 'confirmed' && <button type="button" onClick={() => transition('completed')}>完了</button>}{(reservation.status === 'received' || reservation.status === 'confirmed') && <button type="button" className="danger-button" onClick={() => transition('cancelled')}>取消</button>}<button type="button" onClick={() => props.onRelated(reservation)}>関連する作業日を追加</button><button type="button" onClick={() => props.onReuse(reservation)}>この依頼者情報を使用する</button></div>{(reacceptSource || reacceptedReservations.length > 0) && <section className="reaccept-section"><h3>再受付のつながり</h3>{reacceptSource && <p><strong>再受付元</strong><span>{formatDate(reacceptSource.requestedDate)}・{reacceptSource.reservationCode}・{statusLabels[reacceptSource.status]}</span></p>}{reacceptedReservations.map((item) => <p key={item.reservationId}><strong>再受付先</strong><span>{formatDate(item.requestedDate)}・{item.reservationCode}・{statusLabels[item.status]}</span></p>)}</section>}{related.length > 0 && <section className="related-section"><h3>同じ作業の関連予約</h3>{related.map((item) => <p key={item.reservationId}>{formatDate(item.requestedDate)}・{item.reservationCode}・{statusLabels[item.status]}</p>)}</section>}<section className="history-section"><h3>操作履歴</h3>{logs.map((log) => <div key={log.auditId}><time>{formatDateTime(log.occurredAt)}</time><strong>{auditLabel(log.action)}</strong><span>{log.actor === 'demo-admin' ? 'デモ管理者' : 'デモ初期データ'}</span></div>)}</section></section></div>
}

function AdminReservationEditor({ state, snapshot, onClose, onSaved }: { state: EditorState; snapshot: DemoSnapshot; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const base = state.reservation ?? state.contactSource
  const [input, setInput] = useState<ReservationInput>(() => reservationToInput(state.mode === 'related' ? undefined : state.reservation, state.contactSource ?? state.reservation, state.defaultCategory, state.defaultDate))
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [allowOverride, setAllowOverride] = useState(false)
  const [overrideOffered, setOverrideOffered] = useState(false)
  const [duplicateAccepted, setDuplicateAccepted] = useState(false)
  const today = todayInJapan()
  const dialog = useDialogFocus(onClose)
  const normalizedPhone = normalizePhoneNumber(input.phone)
  const duplicates = snapshot.reservations.filter((item) => item.reservationId !== state.reservation?.reservationId && item.requestedDate === input.requestedDate && item.categoryId === input.categoryId && item.phoneNormalized === normalizedPhone && activeStatuses.has(item.status))
  const save = async () => {
    const errors = validateReservationInput(normalizeAdminInput(input), { channel: 'admin', today })
    if (errors.length > 0) { setError(errors.map((item) => item.message).join(' ')); return }
    if (state.mode === 'related' && !confirmed) { setError('依頼者と追加日程を確認済みにしてください。'); return }
    if (state.mode === 'create' && duplicates.length > 0 && !duplicateAccepted) { setError('同じ電話番号・希望日・カテゴリーの予約があります。別の依頼であれば確認欄を選んでください。'); return }
    if (overrideOffered && !allowOverride) { setError('満枠へ例外登録する場合は確認欄を選んでください。'); return }
    if (state.mode === 'edit' && state.reservation) {
      const summary = `${formatDate(state.reservation.requestedDate)}・${categoryName(state.reservation.categoryId)}から、${formatDate(input.requestedDate)}・${categoryName(input.categoryId)}へ変更します。よろしいですか？`
      if (!window.confirm(summary)) return
    }
    setSaving(true)
    let result: SaveResult
    if (state.mode === 'edit' && state.reservation) result = await demoRepository.updateReservation({ generationId: snapshot.metadata!.generationId, idempotencyKey: crypto.randomUUID(), actor: 'demo-admin', reservationId: state.reservation.reservationId, expectedVersion: state.reservation.version, input: normalizeAdminInput(input), allowFullCapacityOverride: allowOverride })
    else result = await demoRepository.createReservation({ generationId: snapshot.metadata!.generationId, idempotencyKey: crypto.randomUUID(), channel: 'admin', actor: 'demo-admin', input: normalizeAdminInput(input), detailsConfirmed: confirmed, allowFullCapacityOverride: allowOverride, sourceReservationId: state.contactSource?.reservationId, relatedReservation: state.mode === 'related' && state.reservation ? state.reservation : undefined })
    setSaving(false)
    if (result.kind === 'capacityFull' && !allowOverride) { setOverrideOffered(true); setError('選択日は満枠です。内容を確認し、「満枠へ例外登録する」を選ぶと登録できます。'); return }
    if (result.kind === 'success' || result.kind === 'duplicateSuccess') {
      publishDemoChange('reservation', result.payload.reservationId)
      await onSaved(state.mode === 'edit' ? '予約内容を変更しました。' : state.mode === 'related' ? '関連する作業日を追加しました。' : isReaccept ? '再受付を登録しました。' : '電話受付を登録しました。')
    }
    else setError(resultMessage(result, ''))
  }
  const set = (key: keyof ReservationInput, value: unknown) => setInput((current) => ({ ...current, [key]: value }))
  const setCategory = (categoryId: CategoryId) => setInput((current) => ({
    ...current,
    categoryId,
    address: categoryId === 'keikoukan' ? undefined : current.address ?? '',
    categoryAnswers: categoryId === 'keikoukan' ? { approximateTubeCount: '' } : categoryId === 'kagu' ? { itemsAndQuantities: '' } : { typesAndQuantities: '' },
  }))
  const setAnswer = (key: string, value: unknown) => setInput((current) => ({ ...current, categoryAnswers: { ...current.categoryAnswers, [key]: value } }))
  const isReaccept = state.mode === 'create' && state.contactSource?.status === 'cancelled'
  const title = state.mode === 'edit' ? '予約内容を変更' : state.mode === 'related' ? '関連する作業日を追加' : isReaccept ? '取消予約から再受付' : '電話受付を登録'
  // oxlint-disable-next-line react/refs -- The custom hook returns a stable dialog ref and keyboard handler.
  return <div className="modal-backdrop"><section ref={dialog.ref} tabIndex={-1} onKeyDown={dialog.onKeyDown} className="admin-modal editor-modal" role="dialog" aria-modal="true" aria-labelledby="editor-title"><header><div><span className="admin-mode-badge">管理者操作</span><h2 id="editor-title">{title}</h2>{base && <p>参照元：{base.reservationCode}（{formatDate(base.requestedDate)}）</p>}</div><button type="button" className="modal-close" aria-label="入力画面を閉じる" onClick={onClose}>×</button></header>{error && <div className="error-summary" role="alert">{error}</div>}<div className="editor-grid"><label>カテゴリー<select value={input.categoryId} disabled={state.mode === 'related'} onChange={(e) => { setCategory(e.target.value as CategoryId); setDuplicateAccepted(false) }}>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>希望日<input type="date" min={today} value={input.requestedDate} onChange={(e) => { set('requestedDate', e.target.value); setDuplicateAccepted(false) }} /></label><label>会社名<input value={input.companyName} maxLength={100} onChange={(e) => set('companyName', e.target.value)} /></label><label>担当者名<input value={input.contactName} maxLength={50} onChange={(e) => set('contactName', e.target.value)} /></label><label>電話番号<input type="tel" value={input.phone} onChange={(e) => { set('phone', e.target.value); setDuplicateAccepted(false) }} /></label>{input.categoryId !== 'keikoukan' && <label>住所<input value={input.address ?? ''} maxLength={200} onChange={(e) => set('address', e.target.value)} /></label>}{input.categoryId === 'keikoukan' ? <label>{answerLabel(input.categoryId)}<input type="number" min="1" max="9999" value={String(input.categoryAnswers.approximateTubeCount ?? '')} onChange={(e) => setAnswer('approximateTubeCount', e.target.value)} /></label> : <label className="editor-wide">{answerLabel(input.categoryId)}<textarea rows={3} maxLength={300} value={String(input.categoryAnswers[input.categoryId === 'kagu' ? 'itemsAndQuantities' : 'typesAndQuantities'] ?? '')} onChange={(e) => setAnswer(input.categoryId === 'kagu' ? 'itemsAndQuantities' : 'typesAndQuantities', e.target.value)} /></label>}<label className="editor-wide">連絡事項<textarea rows={3} maxLength={500} value={input.contactNotes ?? ''} onChange={(e) => set('contactNotes', e.target.value)} /></label>{input.categoryId !== 'keikoukan' && <label className="editor-check"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />{state.mode === 'related' ? '依頼者と追加日程を確認済み' : '内容と日程を依頼者と確認済み'}</label>}{state.mode === 'create' && duplicates.length > 0 && <div className="duplicate-warning editor-wide"><strong>同じ条件の予約があります</strong>{duplicates.map((item) => <span key={item.reservationId}>{item.reservationCode}・{statusLabels[item.status]}</span>)}<label className="editor-check"><input type="checkbox" checked={duplicateAccepted} onChange={(e) => setDuplicateAccepted(e.target.checked)} />別の依頼として登録する</label></div>}{overrideOffered && <label className="editor-check warning-check"><input type="checkbox" checked={allowOverride} onChange={(e) => setAllowOverride(e.target.checked)} />満枠へ例外登録する</label>}</div><div className="form-actions"><button type="button" className="button secondary" onClick={onClose}>中止する</button><button type="button" className="button admin-primary" disabled={saving} onClick={save}>{saving ? '保存中…' : state.mode === 'edit' ? '変更を保存する' : '登録する'}</button></div></section></div>
}

function Status({ status }: { status: ReservationStatus }) { return <span className={`reservation-status ${status}`}>{statusLabels[status]}</span> }
function Detail({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div> }
function categoryName(id: CategoryId) { return categories.find((item) => item.id === id)?.name ?? id }
function answerLabel(id: CategoryId) { return id === 'keikoukan' ? 'おおよその本数' : id === 'kagu' ? '品目と数量' : '種類とおおよその数量' }
function answerValue(reservation: Reservation) { return reservation.categoryId === 'keikoukan' ? `${String(reservation.categoryAnswers.approximateTubeCount)}本` : String(reservation.categoryAnswers[reservation.categoryId === 'kagu' ? 'itemsAndQuantities' : 'typesAndQuantities']) }
function formatDateTime(value: string) { return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) }
function auditLabel(action: string) { return ({ created: '予約作成', confirmed: '確定', completed: '完了', cancelled: '取消', updated: '内容変更', relatedDateAdded: '関連日追加', reaccepted: '取消予約から再受付', reacceptedAs: '新しい予約として再受付' } as Record<string,string>)[action] ?? action }
function sortReservations(a: Reservation, b: Reservation) { return a.requestedDate.localeCompare(b.requestedDate) || a.createdAt.localeCompare(b.createdAt) }
function previousDate(today: string) { const date = new Date(`${today}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - 1); return date.toISOString().slice(0,10) }
function monthEnd(month: string) { const [year, value] = month.split('-').map(Number); return new Date(Date.UTC(year, value, 0)).toISOString().slice(0,10) }
function addMonth(month: string, amount: number) { const [year,value] = month.split('-').map(Number); const date = new Date(Date.UTC(year, value - 1 + amount, 1)); return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}` }
function monthLabel(month: string) { const [year,value] = month.split('-'); return `${year}年${Number(value)}月` }
function monthCells(month: string): Array<string | undefined> { const [year,value] = month.split('-').map(Number); const first = new Date(Date.UTC(year,value-1,1)).getUTCDay(); const last = new Date(Date.UTC(year,value,0)).getUTCDate(); return [...Array.from<undefined>({length:first}), ...Array.from({length:last},(_,i)=>`${month}-${String(i+1).padStart(2,'0')}`)] }
function maximumDailyCount(snapshot: DemoSnapshot, categoryId: CategoryId) { const counts = new Map<string,number>(); snapshot.reservations.filter((item)=>item.categoryId===categoryId&&activeStatuses.has(item.status)).forEach((item)=>counts.set(item.requestedDate,(counts.get(item.requestedDate)??0)+1)); return Math.max(0,...counts.values()) }
function calendarReservationCount(reservations: Reservation[], date: string, categoryId: CalendarCategoryId) { return reservations.filter((item) => item.requestedDate === date && (!categoryId || item.categoryId === categoryId) && activeStatuses.has(item.status)).length }
function countOverCapacity(snapshot: DemoSnapshot, month: string) { let count=0; for(const category of categories){ const limit=Number(snapshot.settings.find((item)=>item.categoryId===category.id)?.dailyLimit); const dates=new Set(snapshot.reservations.filter((item)=>item.categoryId===category.id&&item.requestedDate.startsWith(month)).map((item)=>item.requestedDate)); for(const date of dates) if(limit>0&&countReservationsForCapacity(snapshot.reservations,date,category.id)>limit) count++ } return count }
function matchesFilters(item: Reservation, filters: ListFilters) { const query=normalizeSearch(filters.query); const haystack=normalizeSearch([item.reservationCode,item.workGroupCode,item.companyName,item.contactName,item.phoneDisplay,item.phoneNormalized].join(' ')); const statusMatches=!filters.status||(filters.status==='unfinished'?(item.status==='received'||item.status==='confirmed'):item.status===filters.status); return (!query||haystack.includes(query))&&(!filters.category||item.categoryId===filters.category)&&statusMatches&&(!filters.from||item.requestedDate>=filters.from)&&(!filters.to||item.requestedDate<=filters.to) }
function normalizeSearch(value: string) { return normalizePhoneNumber(value).toLowerCase().replace(/\s/g,'') }
function reservationToInput(reservation?: Reservation, contact?: Reservation, defaultCategory?: CategoryId, defaultDate?: string): ReservationInput { const categoryId=reservation?.categoryId??(defaultCategory??contact?.categoryId??'keikoukan'); const blankAnswers=categoryId==='keikoukan'?{approximateTubeCount:''}:categoryId==='kagu'?{itemsAndQuantities:''}:{typesAndQuantities:''}; return { categoryId, requestedDate: reservation?.requestedDate??defaultDate??'', companyName: reservation?.companyName??contact?.companyName??'', contactName: reservation?.contactName??contact?.contactName??'', phone: reservation?.phoneDisplay??contact?.phoneDisplay??'', address: categoryId==='keikoukan'?undefined:reservation?.address??contact?.address??'', contactNotes: reservation?.contactNotes??'', categoryAnswers: reservation?.categoryAnswers??blankAnswers } }
function normalizeAdminInput(input: ReservationInput): ReservationInput { if(input.categoryId!=='keikoukan') return input; return {...input,categoryAnswers:{approximateTubeCount:Number(input.categoryAnswers.approximateTubeCount)}} }
function resultMessage(result: SaveResult, success: string) { if(result.kind==='success'||result.kind==='duplicateSuccess') return success; const messages:Record<string,string>={validationError:'入力内容を確認してください。',capacityFull:'選択日は満枠です。',closed:'選択日は受付停止中です。',zeroLimit:'このカテゴリーは上限0で受付停止中です。',invalidSetting:'受付設定が正しくありません。',dateUnavailable:'選択した日は登録できません。',versionConflict:'他の画面で更新されています。最新内容を確認してください。',staleGeneration:'デモデータが初期化または削除されました。再読み込みしてください。',invalidTransition:'現在の状態ではこの操作を行えません。',notFound:'対象の予約が見つかりません。',storageFull:'ブラウザの保存容量が不足しています。',storageUnavailable:'ブラウザ内へ保存できませんでした。'}; return messages[result.kind]??'処理を完了できませんでした。' }

function useDialogFocus(onClose: () => void) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
    if (event.key !== 'Tab' || !ref.current) return
    const focusable = Array.from(ref.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'))
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  return { ref, onKeyDown }
}
