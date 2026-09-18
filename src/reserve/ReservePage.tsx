import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import {
  categories,
  todayInJapan,
  validateReservationInput,
  type CategoryId,
  type OperationResultPayload,
  type ReservationInput,
  type ValidationError,
} from '../domain'
import { ReservationDatePicker } from './ReservationDatePicker'
import { formatDate } from './format'
import { demoRepository, useDemoData } from './useDemoData'
import { publishDemoChange } from './demoSync'

type Step = 'category' | 'input' | 'confirm' | 'complete'
type ContactCarry = Pick<ReservationInput, 'companyName' | 'contactName' | 'phone' | 'address'>

const descriptions: Record<CategoryId, string> = {
  keikoukan: '空き枠があれば申込み時に確定します。持込みは16:00までです。',
  kagu: '受付後に担当者が内容と日程を電話で確認します。',
  binkan: '受付後に担当者が種類・数量と日程を電話で確認します。',
}

const emptyInput = (categoryId: CategoryId, carry?: ContactCarry): ReservationInput => ({
  categoryId,
  requestedDate: '',
  companyName: carry?.companyName ?? '',
  contactName: carry?.contactName ?? '',
  phone: carry?.phone ?? '',
  address: categoryId === 'keikoukan' ? undefined : carry?.address ?? '',
  contactNotes: '',
  categoryAnswers: categoryId === 'keikoukan'
    ? { approximateTubeCount: '' }
    : categoryId === 'kagu'
      ? { itemsAndQuantities: '' }
      : { typesAndQuantities: '' },
  demoNoticeAccepted: false,
})

export function ReservePage() {
  const navigate = useNavigate()
  const { snapshot, loading, error: loadError, refresh } = useDemoData()
  const [step, setStep] = useState<Step>('category')
  const [input, setInput] = useState<ReservationInput>()
  const [errors, setErrors] = useState<ValidationError[]>([])
  const [saveError, setSaveError] = useState<string>()
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<OperationResultPayload>()
  const [carry, setCarry] = useState<ContactCarry>()
  const operationKey = useRef<string | undefined>(undefined)
  const today = todayInJapan()

  const selectCategory = (categoryId: CategoryId) => {
    setInput(emptyInput(categoryId, carry))
    setErrors([])
    setSaveError(undefined)
    setStep('input')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const update = <K extends keyof ReservationInput>(key: K, value: ReservationInput[K]) => {
    if (!input) return
    setInput({ ...input, [key]: value })
    setErrors((current) => current.filter((item) => item.field !== key))
  }

  const updateAnswer = (key: string, value: string | number) => {
    if (!input) return
    setInput({ ...input, categoryAnswers: { ...input.categoryAnswers, [key]: value } })
    setErrors((current) => current.filter((item) => item.field !== key))
  }

  const confirm = () => {
    if (!input) return
    const nextErrors = validateReservationInput(input, { channel: 'public', today })
    setErrors(nextErrors)
    if (nextErrors.length > 0) {
      document.getElementById(`field-${nextErrors[0].field}`)?.focus()
      return
    }
    operationKey.current = crypto.randomUUID()
    setStep('confirm')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const submit = async () => {
    if (!input || !snapshot?.metadata || !operationKey.current) return
    setSaving(true)
    setSaveError(undefined)
    const response = await demoRepository.createReservation({
      generationId: snapshot.metadata.generationId,
      idempotencyKey: operationKey.current,
      channel: 'public',
      actor: 'demo-user',
      input: normalizedInput(input),
    })
    setSaving(false)
    if (response.kind === 'success' || response.kind === 'duplicateSuccess') {
      publishDemoChange('reservation', response.payload.reservationId)
      setResult(response.payload)
      await refresh()
      setStep('complete')
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    if (response.kind === 'staleGeneration') await refresh()
    if (response.kind === 'validationError') setErrors(response.errors)
    setSaveError(saveMessage(response.kind))
  }

  const another = () => {
    if (!input) return
    setCarry({ companyName: input.companyName, contactName: input.contactName, phone: input.phone, address: input.address })
    setInput(undefined)
    setResult(undefined)
    operationKey.current = undefined
    setStep('category')
  }

  const exit = () => {
    setCarry(undefined)
    setInput(undefined)
    navigate('/')
  }

  return (
    <div className="page reserve-page">
      <header className="page-intro reserve-intro">
        <span className="eyebrow">For Customers</span>
        <h1>利用者用 予約申込み</h1>
        <p>カテゴリー選択、入力、確認、受付完了の順に申込みを進めます。</p>
      </header>
      <StepIndicator step={step} />
      {loadError && <div className="error-summary" role="alert">{loadError}</div>}
      {loading && <section className="form-card"><p>予約状況を読み込んでいます…</p></section>}
      {!loading && snapshot?.metadata?.lifecycleState === 'deleted' && <section className="form-card deleted-notice"><h2>デモデータは削除されました</h2><p>別の画面で「データを削除して終了」が実行されました。デモ入口から新しく開始してください。</p><button className="button primary" type="button" onClick={exit}>デモ入口へ戻る</button></section>}
      {!loading && snapshot?.metadata?.lifecycleState === 'active' && step === 'category' && <CategoryStep onSelect={selectCategory} onExit={exit} />}
      {!loading && snapshot?.metadata?.lifecycleState === 'active' && step === 'input' && input && (
        <InputStep input={input} errors={errors} snapshot={snapshot} today={today} onUpdate={update} onAnswer={updateAnswer} onBack={() => setStep('category')} onConfirm={confirm} />
      )}
      {snapshot?.metadata?.lifecycleState === 'active' && step === 'confirm' && input && <ConfirmStep input={input} saving={saving} error={saveError} onBack={() => setStep('input')} onSubmit={submit} />}
      {snapshot?.metadata?.lifecycleState === 'active' && step === 'complete' && input && result && <CompleteStep input={input} result={result} onAnother={another} onExit={exit} />}
    </div>
  )
}

function CategoryStep({ onSelect, onExit }: { onSelect: (id: CategoryId) => void; onExit: () => void }) {
  return (
    <section className="form-card">
      <div className="section-heading"><span>STEP 1</span><h2>予約する内容を選んでください</h2></div>
      <div className="category-grid">
        {categories.map((category) => (
          <button className={`category-choice ${category.id}`} type="button" key={category.id} onClick={() => onSelect(category.id)}>
            <span className="category-icon" aria-hidden="true">{category.id === 'keikoukan' ? '灯' : category.id === 'kagu' ? '家' : '資'}</span>
            <strong>{category.name}</strong><span>{descriptions[category.id]}</span><b>選択する →</b>
          </button>
        ))}
      </div>
      <button className="text-button" type="button" onClick={onExit}>入力を終了して入口へ戻る</button>
    </section>
  )
}

type InputProps = {
  input: ReservationInput
  errors: ValidationError[]
  snapshot: NonNullable<ReturnType<typeof useDemoData>['snapshot']>
  today: string
  onUpdate: <K extends keyof ReservationInput>(key: K, value: ReservationInput[K]) => void
  onAnswer: (key: string, value: string | number) => void
  onBack: () => void
  onConfirm: () => void
}

function InputStep({ input, errors, snapshot, today, onUpdate, onAnswer, onBack, onConfirm }: InputProps) {
  const errorMap = useMemo(() => Object.fromEntries(errors.map((error) => [error.field, error.message])), [errors])
  const category = categories.find((item) => item.id === input.categoryId)!
  return (
    <section className="form-card">
      <div className="section-heading"><span>STEP 2</span><h2>{category.name}の予約内容</h2><p>{descriptions[input.categoryId]}</p></div>
      {errors.length > 0 && <div className="error-summary" role="alert"><strong>入力内容を確認してください</strong><span>{errors.length}件の修正が必要です。</span></div>}
      <div className="form-grid">
        <Field label="会社名" name="companyName" error={errorMap.companyName}><input id="field-companyName" value={input.companyName} maxLength={100} onChange={(e) => onUpdate('companyName', e.target.value)} /></Field>
        <Field label="担当者名" name="contactName" error={errorMap.contactName}><input id="field-contactName" value={input.contactName} maxLength={50} onChange={(e) => onUpdate('contactName', e.target.value)} /></Field>
        <Field label="電話番号" name="phone" hint="ハイフンありでも入力できます" error={errorMap.phone}><input id="field-phone" type="tel" inputMode="tel" value={input.phone} onChange={(e) => onUpdate('phone', e.target.value)} /></Field>
        {input.categoryId !== 'keikoukan' && <Field label="住所" name="address" error={errorMap.address}><input id="field-address" value={input.address ?? ''} maxLength={200} onChange={(e) => onUpdate('address', e.target.value)} /></Field>}
        {input.categoryId === 'keikoukan' && <Field label="おおよその本数" name="approximateTubeCount" error={errorMap.approximateTubeCount}><input id="field-approximateTubeCount" type="number" min="1" max="9999" value={String(input.categoryAnswers.approximateTubeCount ?? '')} onChange={(e) => onAnswer('approximateTubeCount', e.target.value === '' ? '' : Number(e.target.value))} onWheel={(e) => e.currentTarget.blur()} /></Field>}
        {input.categoryId === 'kagu' && <Field label="品目と数量" name="itemsAndQuantities" wide error={errorMap.itemsAndQuantities}><textarea id="field-itemsAndQuantities" rows={3} maxLength={300} value={String(input.categoryAnswers.itemsAndQuantities ?? '')} onChange={(e) => onAnswer('itemsAndQuantities', e.target.value)} /></Field>}
        {input.categoryId === 'binkan' && <Field label="種類とおおよその数量" name="typesAndQuantities" wide error={errorMap.typesAndQuantities}><textarea id="field-typesAndQuantities" rows={3} maxLength={300} value={String(input.categoryAnswers.typesAndQuantities ?? '')} onChange={(e) => onAnswer('typesAndQuantities', e.target.value)} /></Field>}
      </div>
      <ReservationDatePicker categoryId={input.categoryId} today={today} snapshot={snapshot} value={input.requestedDate} onChange={(date) => onUpdate('requestedDate', date)} />
      {errorMap.requestedDate && <p className="field-error" role="alert">{errorMap.requestedDate}</p>}
      <Field label="連絡事項" name="contactNotes" optional wide error={errorMap.contactNotes}><textarea id="field-contactNotes" rows={4} maxLength={500} value={input.contactNotes ?? ''} onChange={(e) => onUpdate('contactNotes', e.target.value)} /><small className="counter">{input.contactNotes?.length ?? 0} / 500文字</small></Field>
      <label className={`demo-check ${errorMap.demoNoticeAccepted ? 'has-error' : ''}`}>
        <input id="field-demoNoticeAccepted" type="checkbox" checked={input.demoNoticeAccepted === true} onChange={(e) => onUpdate('demoNoticeAccepted', e.target.checked)} />
        <span><strong>公開デモの注意事項を確認しました <Required /></strong>実在する会社名・氏名・住所・電話番号は入力しません。</span>
      </label>
      {errorMap.demoNoticeAccepted && <p className="field-error" role="alert">{errorMap.demoNoticeAccepted}</p>}
      <div className="form-actions"><button type="button" className="button secondary" onClick={onBack}>カテゴリー選択へ戻る</button><button type="button" className="button primary" onClick={onConfirm}>入力内容を確認する</button></div>
    </section>
  )
}

function ConfirmStep({ input, saving, error, onBack, onSubmit }: { input: ReservationInput; saving: boolean; error?: string; onBack: () => void; onSubmit: () => void }) {
  const category = categories.find((item) => item.id === input.categoryId)!
  const status = input.categoryId === 'keikoukan' ? '確定' : '受付'
  return (
    <section className="form-card confirmation-card">
      <div className="section-heading"><span>STEP 3</span><h2>入力内容をご確認ください</h2><p><b className="pending-badge">未送信</b> 申込み後の状態は「{status}」です。</p></div>
      {error && <div className="error-summary" role="alert">{error}</div>}
      <dl className="summary-list">
        <Summary label="カテゴリー" value={category.name} /><Summary label="希望日" value={formatDate(input.requestedDate)} />
        <Summary label="会社名" value={input.companyName} /><Summary label="担当者名" value={input.contactName} />
        <Summary label="電話番号" value={input.phone} />{input.address && <Summary label="住所" value={input.address} />}
        <Summary label={answerLabel(input.categoryId)} value={answerValue(input)} />
        <Summary label="連絡事項" value={input.contactNotes || 'なし'} />
      </dl>
      <div className="form-actions no-print"><button type="button" className="button secondary" disabled={saving} onClick={onBack}>入力内容を修正する</button><button type="button" className="button primary" disabled={saving} onClick={onSubmit}>{saving ? '送信中…' : 'この内容で申し込む'}</button></div>
    </section>
  )
}

function CompleteStep({ input, result, onAnother, onExit }: { input: ReservationInput; result: OperationResultPayload; onAnother: () => void; onExit: () => void }) {
  const confirmed = input.categoryId === 'keikoukan'
  return (
    <section className="form-card completion-card">
      <div className="completion-mark" aria-hidden="true">✓</div>
      <span className="eyebrow">Reservation received</span>
      <h2>{confirmed ? '予約が確定しました' : '申込みを受け付けました'}</h2>
      <p className="receipt-code"><span>受付番号</span><strong>{result.reservationCode}</strong></p>
      <p className={`status-pill ${confirmed ? 'confirmed' : 'received'}`}>現在状態：{confirmed ? '確定' : '受付'}</p>
      <dl className="summary-list printable-summary">
        <Summary label="カテゴリー" value={categories.find((item) => item.id === input.categoryId)!.name} /><Summary label="希望日" value={formatDate(input.requestedDate)} />
        <Summary label="会社名" value={input.companyName} /><Summary label="担当者名" value={input.contactName} /><Summary label="電話番号" value={input.phone} />
        {input.address && <Summary label="住所" value={input.address} />}<Summary label={answerLabel(input.categoryId)} value={answerValue(input)} /><Summary label="連絡事項" value={input.contactNotes || 'なし'} />
      </dl>
      <div className="next-guidance"><h3>今後のご案内</h3><p>{confirmed ? '予約日にお持ち込みください。持込み受付は16:00までです。' : '担当者が内容と日程を確認し、入力された電話番号へご連絡します。'}</p><p>変更・取消は受付番号をご用意のうえ、9:00～16:00に早めにお電話ください。</p><small>実運用時の案内例です。デモのため実際の連絡は不要です。</small></div>
      <div className="form-actions completion-actions no-print"><button type="button" className="button secondary" onClick={() => window.print()}>受付内容を印刷する</button><button type="button" className="button secondary" onClick={onAnother}>同じ依頼者で別の予約をする</button><button type="button" className="button primary" onClick={onExit}>入力を終了する</button></div>
    </section>
  )
}

function Field({ label, name, hint, error, optional, wide, children }: { label: string; name: string; hint?: string; error?: string; optional?: boolean; wide?: boolean; children: ReactNode }) {
  return <label className={`field ${wide ? 'wide' : ''} ${error ? 'has-error' : ''}`} htmlFor={`field-${name}`}><span className="field-label">{label} {optional ? <em>任意</em> : <Required />}</span>{hint && <small>{hint}</small>}{children}{error && <span className="field-error" role="alert">{error}</span>}</label>
}

function Summary({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd>{value}</dd></div> }
function Required() { return <span className="required">必須</span> }

function StepIndicator({ step }: { step: Step }) {
  const active = step === 'category' ? 1 : step === 'input' ? 2 : step === 'confirm' ? 3 : 4
  return <ol className="steps" aria-label="申込みの進み具合">{['カテゴリー', '入力', '確認', '完了'].map((label, index) => <li key={label} className={active >= index + 1 ? 'active' : ''} aria-current={active === index + 1 ? 'step' : undefined}><span>{index + 1}</span>{label}</li>)}</ol>
}

function normalizedInput(input: ReservationInput): ReservationInput {
  if (input.categoryId !== 'keikoukan') return input
  return { ...input, categoryAnswers: { approximateTubeCount: Number(input.categoryAnswers.approximateTubeCount) } }
}

function answerLabel(categoryId: CategoryId) { return categoryId === 'keikoukan' ? 'おおよその本数' : categoryId === 'kagu' ? '品目と数量' : '種類とおおよその数量' }
function answerValue(input: ReservationInput) { return input.categoryId === 'keikoukan' ? `${input.categoryAnswers.approximateTubeCount}本` : String(input.categoryAnswers[input.categoryId === 'kagu' ? 'itemsAndQuantities' : 'typesAndQuantities']) }

function saveMessage(kind: string): string {
  const messages: Record<string, string> = {
    capacityFull: '選択した日は、確認中に満枠になりました。別の日を選んでください。', closed: '選択した日は受付停止になりました。別の日を選んでください。', zeroLimit: '選択した日は受付を停止しています。', invalidSetting: '受付設定を確認できないため保存できません。', dateUnavailable: '選択した日は予約できません。', staleGeneration: 'デモデータが更新されました。画面を再読み込みしてください。', idempotencyConflict: '送信内容を確認できませんでした。入力内容を保持したまま、最初からお試しください。', storageFull: 'ブラウザの保存容量が不足しています。入力内容は画面に残っています。', storageUnavailable: 'ブラウザ内へ保存できませんでした。入力内容は画面に残っています。',
  }
  return messages[kind] ?? '申込みを保存できませんでした。入力内容を確認して、もう一度お試しください。'
}
