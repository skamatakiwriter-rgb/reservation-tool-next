import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { vehicleName, type SaveResult, type Vehicle, type VehicleInput } from '../domain'
import { PageHelp } from '../guide/PageHelp'
import { publishDemoChange } from '../reserve/demoSync'
import { demoRepository, useDemoData } from '../reserve/useDemoData'
import { useModalFocus } from '../useModalFocus'

type VehicleEditorState = { mode: 'create' } | { mode: 'edit'; vehicle: Vehicle }

export function VehicleManagementPage() {
  const isAdminActive = sessionStorage.getItem('reservation-demo-admin') === 'active'
  const { snapshot, loading, error, refresh } = useDemoData('admin')
  const [editor, setEditor] = useState<VehicleEditorState>()
  const [message, setMessage] = useState<string>()
  const [showInactive, setShowInactive] = useState(true)

  const vehicles = useMemo(() => {
    const source = snapshot?.vehicles ?? []
    return source.filter((vehicle) => showInactive || vehicle.isActive).sort((a, b) => a.vehicleCode.localeCompare(b.vehicleCode, 'ja'))
  }, [showInactive, snapshot?.vehicles])

  if (!isAdminActive) {
    return <div className="page driver-management-gate"><header className="page-intro"><span className="eyebrow blue-text">Vehicle Master</span><h1>車両管理</h1><p>車両情報は管理者デモから登録・変更できます。</p></header><Link className="primary-link compact" to="/admin">予約・配車管理を開始する</Link></div>
  }
  if (loading) return <div className="page driver-management-page"><p>車両情報を読み込んでいます…</p></div>
  if (error || !snapshot?.metadata) return <div className="page driver-management-page"><div className="error-summary" role="alert">{error ?? '車両情報を読み込めませんでした。'}</div></div>

  const toggleActive = async (vehicle: Vehicle) => {
    const nextActive = !vehicle.isActive
    if (!nextActive && !window.confirm(`${vehicleName(vehicle)}を無効にします。未完了の配車または車両保留がある場合は無効にできません。よろしいですか？`)) return
    const result = await demoRepository.setVehicleActive({
      generationId: snapshot.metadata!.generationId,
      idempotencyKey: crypto.randomUUID(),
      actor: 'demo-admin',
      vehicleId: vehicle.vehicleId,
      expectedVersion: vehicle.version,
      isActive: nextActive,
    })
    if (isSuccess(result)) publishDemoChange('vehicle', vehicle.vehicleId)
    setMessage(vehicleResultMessage(result, nextActive ? '車両を有効にしました。' : '車両を無効にしました。'))
    await refresh()
  }

  return (
    <div className="driver-management-page">
      <header className="admin-toolbar">
        <div><span className="admin-mode-badge">デモ管理者モード</span><h1>車両管理</h1></div>
        <div className="admin-toolbar-actions"><Link className="toolbar-link" to="/admin">予約・配車管理へ戻る</Link></div>
      </header>
      <div className="driver-management-content">
        {message && <div className="admin-message" role="status">{message}<button type="button" aria-label="お知らせを閉じる" onClick={() => setMessage(undefined)}>×</button></div>}
        <PageHelp title="この画面の使い方" anchor="vehicle-master" steps={['「車両を登録」から架空の車両ナンバーと車種を入力します。コードは自動採番されます。', '車両ナンバーや参考情報を変更する場合は「編集」を選びます。', '使用しない車両を配車対象から外す場合は「無効にする」を選びます。']} />
        <section className="driver-master-panel" aria-labelledby="vehicle-master-title">
          <div className="driver-master-heading">
            <div><h2 id="vehicle-master-title">登録車両</h2><p>車両ナンバーを主表示します。無効な車両も過去の配車記録には残ります。</p></div>
            <button type="button" className="button admin-primary" onClick={() => setEditor({ mode: 'create' })}>車両を登録</button>
          </div>
          <div className="driver-master-options">
            <label><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} /> 無効な車両も表示</label>
            <span>有効 {snapshot.vehicles.filter((vehicle) => vehicle.isActive).length}台 / 全{snapshot.vehicles.length}台</span>
          </div>
          {vehicles.length === 0 ? <p className="empty-state">表示できる車両がありません。</p> : (
            <div className="driver-table-wrap"><table className="driver-table"><thead><tr><th>状態</th><th>車両コード</th><th>車両ナンバー</th><th>車種</th><th>積載参考情報</th><th>用途・注意事項</th><th>車両保留</th><th>操作</th></tr></thead><tbody>{vehicles.map((vehicle) => <tr key={vehicle.vehicleId}><td><span className={`driver-active-state ${vehicle.isActive ? 'active' : 'inactive'}`}>{vehicle.isActive ? '有効' : '無効'}</span></td><td><code>{vehicle.vehicleCode}</code></td><td>{vehicleName(vehicle)}</td><td>{vehicle.vehicleType}</td><td className="driver-notes">{vehicle.capacityNote || '—'}</td><td className="driver-notes">{vehicle.usageNotes || '—'}</td><td>{vehicle.loadHold ? <span className={`vehicle-hold-chip ${vehicle.loadHold.status}`}>{vehicle.loadHold.status === 'decisionPending' ? '搬入判断待ち' : '積み置き中'}</span> : '—'}</td><td><div className="driver-row-actions"><button type="button" onClick={() => setEditor({ mode: 'edit', vehicle })}>編集</button><button type="button" className={vehicle.isActive ? 'danger-button' : ''} onClick={() => void toggleActive(vehicle)}>{vehicle.isActive ? '無効にする' : '有効にする'}</button></div></td></tr>)}</tbody></table></div>
          )}
        </section>
      </div>
      {editor && <VehicleEditor state={editor} generationId={snapshot.metadata.generationId} onClose={() => setEditor(undefined)} onSaved={async (text, vehicleId) => { setEditor(undefined); setMessage(text); publishDemoChange('vehicle', vehicleId); await refresh() }} />}
    </div>
  )
}

function VehicleEditor({ state, generationId, onClose, onSaved }: { state: VehicleEditorState; generationId: string; onClose: () => void; onSaved: (message: string, vehicleId?: string) => Promise<void> }) {
  useModalFocus(onClose, 'vehicle-editor-title')
  const editing = state.mode === 'edit' ? state.vehicle : undefined
  const [registrationNumber, setRegistrationNumber] = useState(editing ? vehicleName(editing) : '')
  const [vehicleType, setVehicleType] = useState(editing?.vehicleType ?? '')
  const [capacityNote, setCapacityNote] = useState(editing?.capacityNote ?? '')
  const [usageNotes, setUsageNotes] = useState(editing?.usageNotes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError(undefined)
    const input: VehicleInput = { registrationNumber, vehicleType, capacityNote, usageNotes }
    const result = editing
      ? await demoRepository.updateVehicle({ generationId, idempotencyKey: crypto.randomUUID(), actor: 'demo-admin', vehicleId: editing.vehicleId, expectedVersion: editing.version, input })
      : await demoRepository.createVehicle({ generationId, idempotencyKey: crypto.randomUUID(), actor: 'demo-admin', input })
    if (isSuccess(result)) {
      await onSaved(editing ? '車両情報を更新しました。' : '車両を登録しました。', result.payload.vehicleId)
      return
    }
    setError(vehicleResultMessage(result, ''))
    setSaving(false)
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="admin-modal driver-editor-modal" role="dialog" aria-modal="true" aria-labelledby="vehicle-editor-title"><header><div><span className="admin-mode-badge">車両マスター</span><h2 id="vehicle-editor-title">{editing ? '車両情報を編集' : '車両を登録'}</h2><p>実在する車両ナンバーは入力せず、架空データでお試しください。</p></div><button className="modal-close" type="button" aria-label="車両編集を閉じる" onClick={onClose}>×</button></header><form onSubmit={(event) => void submit(event)}><div className="driver-editor-grid"><label>車両ナンバー<span>必須・各画面の主表示</span><input aria-label="車両ナンバー" value={registrationNumber} maxLength={30} onChange={(event) => setRegistrationNumber(event.target.value)} required /></label><label>車種<span>必須・50文字以内</span><input aria-label="車種" value={vehicleType} maxLength={50} onChange={(event) => setVehicleType(event.target.value)} required /></label><label className="driver-editor-wide">積載参考情報<span>任意・200文字以内。自動判定には使用しません</span><textarea aria-label="積載参考情報" value={capacityNote} maxLength={200} rows={3} onChange={(event) => setCapacityNote(event.target.value)} /></label><label className="driver-editor-wide">用途・注意事項<span>任意・300文字以内</span><textarea aria-label="用途・注意事項" value={usageNotes} maxLength={300} rows={3} onChange={(event) => setUsageNotes(event.target.value)} /></label></div><p className="driver-code-note">車両コードは登録時に自動採番され、登録後も変更されません。</p>{error && <div className="error-summary" role="alert">{error}</div>}<div className="driver-editor-actions"><button type="button" onClick={onClose}>キャンセル</button><button type="submit" className="inline-primary" disabled={saving}>{saving ? '保存中…' : editing ? '変更を保存' : '登録する'}</button></div></form></section></div>
}

function isSuccess(result: SaveResult): result is Extract<SaveResult, { kind: 'success' | 'duplicateSuccess' }> {
  return result.kind === 'success' || result.kind === 'duplicateSuccess'
}

function vehicleResultMessage(result: SaveResult, successMessage: string): string {
  if (isSuccess(result)) return successMessage
  if (result.kind === 'validationError') return result.errors[0]?.message ?? '入力内容を確認してください。'
  const messages: Partial<Record<SaveResult['kind'], string>> = {
    vehicleRegistrationConflict: '同じ車両ナンバーが登録されています。表記を確認してください。',
    vehicleHasActiveDispatches: '未完了の配車が残っているため無効にできません。先に配車変更または配車取消を行ってください。',
    vehicleHasLoadHold: '搬入判断待ちまたは積み置き中のため無効にできません。対象予約で車両保留を解除してください。',
    vehicleVersionConflict: '別の画面で車両情報が更新されています。再読み込みしてから操作してください。',
    staleGeneration: 'デモデータが初期化されています。画面を再読み込みしてください。',
    notFound: '対象の車両が見つかりません。',
    storageFull: 'ブラウザの保存容量が不足しています。',
    storageUnavailable: 'ブラウザ内へ保存できませんでした。',
  }
  return messages[result.kind] ?? '車両情報を保存できませんでした。'
}
