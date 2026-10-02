import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { driverName, type Driver, type DriverInput, type SaveResult } from '../domain'
import { PageHelp } from '../guide/PageHelp'
import { publishDemoChange } from '../reserve/demoSync'
import { demoRepository, useDemoData } from '../reserve/useDemoData'

type DriverEditorState = { mode: 'create' } | { mode: 'edit'; driver: Driver }

export function DriverManagementPage() {
  const isAdminActive = sessionStorage.getItem('reservation-demo-admin') === 'active'
  const { snapshot, loading, error, refresh } = useDemoData('admin')
  const [editor, setEditor] = useState<DriverEditorState>()
  const [message, setMessage] = useState<string>()
  const [showInactive, setShowInactive] = useState(true)

  const drivers = useMemo(() => {
    const source = snapshot?.drivers ?? []
    return source.filter((driver) => showInactive || driver.isActive).sort((a, b) => a.driverCode.localeCompare(b.driverCode, 'ja'))
  }, [showInactive, snapshot?.drivers])

  if (!isAdminActive) {
    return <div className="page driver-management-gate"><header className="page-intro"><span className="eyebrow blue-text">Driver Master</span><h1>ドライバー管理</h1><p>ドライバー情報は管理者デモから登録・変更できます。</p></header><Link className="primary-link compact" to="/admin">予約・配車管理を開始する</Link></div>
  }
  if (loading) return <div className="page driver-management-page"><p>ドライバー情報を読み込んでいます…</p></div>
  if (error || !snapshot?.metadata) return <div className="page driver-management-page"><div className="error-summary" role="alert">{error ?? 'ドライバー情報を読み込めませんでした。'}</div></div>

  const toggleActive = async (driver: Driver) => {
    const nextActive = !driver.isActive
    if (!nextActive && !window.confirm(`${driverName(driver)}を無効にします。未完了の配車がある場合は無効にできません。よろしいですか？`)) return
    const result = await demoRepository.setDriverActive({
      generationId: snapshot.metadata!.generationId,
      idempotencyKey: crypto.randomUUID(),
      actor: 'demo-admin',
      driverId: driver.driverId,
      expectedVersion: driver.version,
      isActive: nextActive,
    })
    if (isSuccess(result)) publishDemoChange('driver', driver.driverId)
    setMessage(driverResultMessage(result, nextActive ? 'ドライバーを有効にしました。' : 'ドライバーを無効にしました。'))
    await refresh()
  }

  return (
    <div className="driver-management-page">
      <header className="admin-toolbar">
        <div><span className="admin-mode-badge">デモ管理者モード</span><h1>ドライバー管理</h1></div>
        <div className="admin-toolbar-actions"><Link className="toolbar-link" to="/admin">予約・配車管理へ戻る</Link></div>
      </header>
      <div className="driver-management-content">
        {message && <div className="admin-message" role="status">{message}<button type="button" aria-label="お知らせを閉じる" onClick={() => setMessage(undefined)}>×</button></div>}
        <PageHelp title="この画面の使い方" anchor="driver-master" steps={['「ドライバーを登録」から氏名と必要な備考を入力します。コードは自動採番されます。', '氏名や備考を変更する場合は「編集」を選びます。', '退職・休職などで配車対象から外す場合は「無効にする」を選びます。']} />
        <section className="driver-master-panel" aria-labelledby="driver-master-title">
          <div className="driver-master-heading">
            <div><h2 id="driver-master-title">登録ドライバー</h2><p>コードは登録時に自動採番されます。無効なドライバーも過去の配車記録には残ります。</p></div>
            <button type="button" className="button admin-primary" onClick={() => setEditor({ mode: 'create' })}>ドライバーを登録</button>
          </div>
          <div className="driver-master-options">
            <label><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} /> 無効なドライバーも表示</label>
            <span>有効 {snapshot.drivers.filter((driver) => driver.isActive).length}名 / 全{snapshot.drivers.length}名</span>
          </div>
          {drivers.length === 0 ? <p className="empty-state">表示できるドライバーがいません。</p> : (
            <div className="driver-table-wrap"><table className="driver-table"><thead><tr><th>状態</th><th>ドライバーコード</th><th>氏名</th><th>備考</th><th>操作</th></tr></thead><tbody>{drivers.map((driver) => <tr key={driver.driverId}><td><span className={`driver-active-state ${driver.isActive ? 'active' : 'inactive'}`}>{driver.isActive ? '有効' : '無効'}</span></td><td><code>{driver.driverCode}</code></td><td>{driverName(driver)}</td><td className="driver-notes">{driver.notes || '—'}</td><td><div className="driver-row-actions"><button type="button" onClick={() => setEditor({ mode: 'edit', driver })}>編集</button><button type="button" className={driver.isActive ? 'danger-button' : ''} onClick={() => void toggleActive(driver)}>{driver.isActive ? '無効にする' : '有効にする'}</button></div></td></tr>)}</tbody></table></div>
          )}
        </section>
      </div>
      {editor && <DriverEditor state={editor} generationId={snapshot.metadata.generationId} onClose={() => setEditor(undefined)} onSaved={async (text, driverId) => { setEditor(undefined); setMessage(text); publishDemoChange('driver', driverId); await refresh() }} />}
    </div>
  )
}

function DriverEditor({ state, generationId, onClose, onSaved }: { state: DriverEditorState; generationId: string; onClose: () => void; onSaved: (message: string, driverId?: string) => Promise<void> }) {
  const editing = state.mode === 'edit' ? state.driver : undefined
  const [fullName, setFullName] = useState(editing ? driverName(editing) : '')
  const [notes, setNotes] = useState(editing?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError(undefined)
    const input: DriverInput = { fullName, notes }
    const result = editing
      ? await demoRepository.updateDriver({ generationId, idempotencyKey: crypto.randomUUID(), actor: 'demo-admin', driverId: editing.driverId, expectedVersion: editing.version, input })
      : await demoRepository.createDriver({ generationId, idempotencyKey: crypto.randomUUID(), actor: 'demo-admin', input })
    if (isSuccess(result)) {
      await onSaved(editing ? 'ドライバー情報を更新しました。' : 'ドライバーを登録しました。', result.payload.driverId)
      return
    }
    setError(driverResultMessage(result, ''))
    setSaving(false)
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="admin-modal driver-editor-modal" role="dialog" aria-modal="true" aria-labelledby="driver-editor-title"><header><div><span className="admin-mode-badge">ドライバーマスター</span><h2 id="driver-editor-title">{editing ? 'ドライバー情報を編集' : 'ドライバーを登録'}</h2><p>実在する個人情報は入力せず、架空データでお試しください。</p></div><button className="modal-close" type="button" aria-label="ドライバー編集を閉じる" onClick={onClose}>×</button></header><form onSubmit={(event) => void submit(event)}><div className="driver-editor-grid"><label>氏名<span>必須・配車画面とドライバー画面にも表示</span><input aria-label="氏名" value={fullName} maxLength={80} onChange={(event) => setFullName(event.target.value)} required /></label><label className="driver-editor-wide">備考<span>任意・500文字以内</span><textarea aria-label="備考" value={notes} maxLength={500} rows={4} onChange={(event) => setNotes(event.target.value)} /></label></div><p className="driver-code-note">ドライバーコードは登録時に自動採番され、登録後も変更されません。</p>{error && <div className="error-summary" role="alert">{error}</div>}<div className="driver-editor-actions"><button type="button" onClick={onClose}>キャンセル</button><button type="submit" className="inline-primary" disabled={saving}>{saving ? '保存中…' : editing ? '変更を保存' : '登録する'}</button></div></form></section></div>
}

function isSuccess(result: SaveResult): result is Extract<SaveResult, { kind: 'success' | 'duplicateSuccess' }> {
  return result.kind === 'success' || result.kind === 'duplicateSuccess'
}

function driverResultMessage(result: SaveResult, successMessage: string): string {
  if (isSuccess(result)) return successMessage
  if (result.kind === 'validationError') return result.errors[0]?.message ?? '入力内容を確認してください。'
  const messages: Partial<Record<SaveResult['kind'], string>> = {
    driverHasActiveDispatches: '未完了の配車が残っているため無効にできません。先に配車変更または配車取消を行ってください。',
    versionConflict: '別の画面でドライバー情報が更新されています。再読み込みしてから操作してください。',
    staleGeneration: 'デモデータが初期化されています。画面を再読み込みしてください。',
    notFound: '対象のドライバーが見つかりません。',
    storageFull: 'ブラウザの保存容量が不足しています。',
    storageUnavailable: 'ブラウザ内へ保存できませんでした。',
  }
  return messages[result.kind] ?? 'ドライバー情報を保存できませんでした。'
}
