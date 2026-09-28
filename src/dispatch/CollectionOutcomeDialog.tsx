import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { validateCollectionOutcome, type CollectionOutcome, type DispatchAssignment, type Reservation } from '../domain'
import { formatDate } from '../reserve/format'
import './CollectionOutcomeDialog.css'

export type CollectionOutcomeInput = {
  outcome: CollectionOutcome
  actualCollectionSummary?: string
  outcomeNotes?: string
  holdRequest?: { reason: string; consultationNote?: string }
}

type Props = {
  reservation: Reservation
  assignment: DispatchAssignment
  vehicleName: string
  driverName: string
  allowVehicleHold: boolean
  onClose: () => void
  onSubmit: (input: CollectionOutcomeInput) => Promise<string | undefined>
}

export function CollectionOutcomeDialog({ reservation, assignment, vehicleName, driverName, allowVehicleHold, onClose, onSubmit }: Props) {
  const [outcome, setOutcome] = useState<CollectionOutcome>()
  const [actualCollectionSummary, setActualCollectionSummary] = useState('')
  const [outcomeNotes, setOutcomeNotes] = useState('')
  const [requestHold, setRequestHold] = useState(false)
  const [holdReason, setHoldReason] = useState('')
  const [consultationNote, setConsultationNote] = useState('')
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const dialogRef = useRef<HTMLElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus()
    return () => previousFocusRef.current?.focus()
  }, [])
  const close = () => {
    const dirty = outcome || actualCollectionSummary || outcomeNotes || requestHold || holdReason || consultationNote
    if (dirty && !window.confirm('入力中の作業結果を破棄して戻りますか？')) return
    onClose()
  }
  const save = async () => {
    if (savingRef.current) return
    if (!outcome) { setError('回収結果を選択してください。'); return }
    const errors = validateCollectionOutcome(outcome, actualCollectionSummary, outcomeNotes)
    if (errors.length > 0) { setError(errors[0].message); return }
    if (requestHold && (!holdReason.trim() || holdReason.trim().length > 500)) { setError('搬入判断待ちの理由を500文字以内で入力してください。'); return }
    if (consultationNote.length > 500) { setError('相談内容は500文字以内にしてください。'); return }
    savingRef.current = true; setSaving(true); setError(undefined)
    try {
      const submitError = await onSubmit({ outcome, actualCollectionSummary: actualCollectionSummary.trim() || undefined, outcomeNotes: outcomeNotes.trim() || undefined, holdRequest: requestHold ? { reason: holdReason.trim(), consultationNote: consultationNote.trim() || undefined } : undefined })
      if (submitError) setError(submitError)
    } finally {
      savingRef.current = false; setSaving(false)
    }
  }
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && !saving) { event.preventDefault(); close(); return }
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'))
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  const holdAllowedForOutcome = outcome !== 'notCollected'

  return <div className="outcome-backdrop"><section ref={dialogRef} tabIndex={-1} onKeyDown={onKeyDown} className="outcome-dialog" role="dialog" aria-modal="true" aria-labelledby="outcome-title">
    <header><div><span>作業終了時に登録</span><h2 id="outcome-title">作業結果を登録</h2><p>{reservation.reservationCode}・{reservation.companyName}</p></div><button type="button" aria-label="作業結果画面を閉じる" disabled={saving} onClick={close}>×</button></header>
    {error && <div className="error-summary" role="alert">{error}</div>}
    <dl className="outcome-summary"><div><dt>配車予定</dt><dd>{formatDate(assignment.plannedDate)} {assignment.plannedStartTime}–{assignment.plannedEndTime}</dd></div><div><dt>車両・主担当</dt><dd>{vehicleName}・{driverName}</dd></div><div><dt>開始日時</dt><dd>{assignment.startedAt ? formatDateTime(assignment.startedAt) : '開始記録なし（任意）'}</dd></div></dl>
    <fieldset className="outcome-choices"><legend>回収結果</legend><label><input type="radio" name="collection-outcome" checked={outcome === 'allCollected'} onChange={() => { setOutcome('allCollected'); setRequestHold(false) }} /><span><strong>全量回収</strong><small>今回の依頼分をすべて回収した</small></span></label><label><input type="radio" name="collection-outcome" checked={outcome === 'partiallyCollected'} onChange={() => setOutcome('partiallyCollected')} /><span><strong>一部回収（今回の配車を終了し、残りあり）</strong><small>別日または別車両・別担当者による対応が必要</small></span></label><label><input type="radio" name="collection-outcome" checked={outcome === 'notCollected'} onChange={() => { setOutcome('notCollected'); setRequestHold(false) }} /><span><strong>回収できず</strong><small>今回は回収できず、理由確認または再対応が必要</small></span></label></fieldset>
    <p className="continue-guidance">同じ日・同じ車両・同じ主担当ドライバーで回収を続ける場合は、結果を保存せずこの画面を閉じてください。「一部回収」は今回の配車を終了する場合だけ選びます。</p>
    <label className="outcome-field">実際の回収内容{outcome === 'partiallyCollected' && <b>必須</b>}<textarea rows={3} maxLength={500} value={actualCollectionSummary} onChange={(event) => setActualCollectionSummary(event.target.value)} /><small>{actualCollectionSummary.length} / 500文字</small></label>
    <label className="outcome-field">結果・次回対応メモ{(outcome === 'partiallyCollected' || outcome === 'notCollected') && <b>必須</b>}<textarea rows={3} maxLength={500} value={outcomeNotes} onChange={(event) => setOutcomeNotes(event.target.value)} /><small>{outcomeNotes.length} / 500文字</small></label>
    {allowVehicleHold && holdAllowedForOutcome && <div className="hold-request"><label><input type="checkbox" checked={requestHold} onChange={(event) => setRequestHold(event.target.checked)} /><span><strong>同時に「搬入判断待ち」を記録する</strong><small>現地回収後、搬入できず配車担当者との電話相談が必要な場合</small></span></label>{requestHold && <><label>搬入できない理由<b>必須</b><textarea rows={2} maxLength={500} value={holdReason} onChange={(event) => setHoldReason(event.target.value)} /></label><label>電話相談の状況<textarea rows={2} maxLength={500} value={consultationNote} onChange={(event) => setConsultationNote(event.target.value)} /></label><p>解除予定日時は入力しません。相談後に「積み置き中」または「保留解除」を別途記録します。</p></>}</div>}
    <div className="outcome-actions"><button type="button" disabled={saving} onClick={close}>戻る</button><button type="button" className="save" disabled={saving} onClick={save}>{saving ? '保存中…' : '作業結果を保存して終了'}</button></div>
  </section></div>
}

function formatDateTime(value: string) { return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) }
