import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type { SaveResult } from '../domain'
import { publishDemoChange } from '../reserve/demoSync'
import { demoRepository, useDemoData } from '../reserve/useDemoData'

export function DemoDataPage() {
  const navigate = useNavigate()
  const { snapshot, loading, error, refresh } = useDemoData('admin')
  const [message, setMessage] = useState<string>()
  const [busy, setBusy] = useState(false)

  const reset = async () => {
    if (!snapshot?.metadata || busy) return
    if (!window.confirm('このブラウザ内の変更を消去し、予約・配車の架空初期データへ戻します。よろしいですか？')) return
    setBusy(true)
    const result = await demoRepository.resetDemoData(snapshot.metadata.generationId)
    if (result.kind === 'success' || result.kind === 'duplicateSuccess') {
      publishDemoChange('reset')
      setMessage('デモデータを初期状態に戻しました。')
      await refresh()
    } else {
      setMessage(dataActionMessage(result))
    }
    setBusy(false)
  }

  const remove = async () => {
    if (!snapshot?.metadata || busy) return
    if (!window.confirm('このブラウザ内の予約、配車、ドライバー、設定、履歴をすべて削除します。元に戻せません。よろしいですか？')) return
    setBusy(true)
    const result = await demoRepository.deleteDemoData(snapshot.metadata.generationId)
    if (result.kind === 'success' || result.kind === 'duplicateSuccess') {
      publishDemoChange('deleted')
      sessionStorage.removeItem('reservation-demo-admin')
      navigate('/', { replace: true })
      return
    }
    setMessage(dataActionMessage(result))
    setBusy(false)
  }

  return (
    <div className="page demo-data-page">
      <header className="page-intro">
        <span className="eyebrow">Demo Data</span>
        <h1>デモデータ管理</h1>
        <p>このブラウザに保存された公開デモ用データを、初期状態へ戻すか削除できます。</p>
      </header>

      <div className="demo-data-notice" role="note">
        <strong>この操作は、利用者・管理者・ドライバーの全画面に反映されます。</strong>
        <span>実在する情報は入力せず、確認を続ける場合は削除ではなく「初期状態に戻す」を使用してください。</span>
      </div>

      {message && <div className="demo-data-message" role="status">{message}</div>}
      {loading && <p className="demo-data-loading">デモデータを確認しています…</p>}
      {error && <div className="error-summary" role="alert">{error}</div>}

      {!loading && !error && snapshot?.metadata && (
        <section className="demo-data-actions" aria-label="デモデータの操作">
          <article>
            <span className="status-badge">試用を続ける場合</span>
            <h2>初期状態に戻す</h2>
            <p>入力・変更した内容を消去し、架空の予約・配車・ドライバーなどを最初の状態へ戻します。</p>
            <button className="button secondary" type="button" disabled={busy} onClick={() => void reset()}>{busy ? '処理中…' : '初期状態に戻す'}</button>
          </article>
          <article className="danger-zone">
            <span className="danger-badge">試用を終える場合</span>
            <h2>すべて削除する</h2>
            <p>このブラウザ内の予約、配車、ドライバー、設定、履歴を削除してデモ入口へ戻ります。この操作は元に戻せません。</p>
            <button className="button danger" type="button" disabled={busy} onClick={() => void remove()}>{busy ? '処理中…' : 'デモデータを削除して入口へ戻る'}</button>
          </article>
        </section>
      )}

      <Link className="secondary-link" to="/">デモ入口へ戻る</Link>
    </div>
  )
}

function dataActionMessage(result: SaveResult): string {
  if (result.kind === 'staleGeneration') return '別の画面でデモデータが更新されています。画面を再読み込みしてください。'
  if (result.kind === 'storageFull' || result.kind === 'storageUnavailable') return result.message
  return 'デモデータを変更できませんでした。画面を再読み込みしてお試しください。'
}
