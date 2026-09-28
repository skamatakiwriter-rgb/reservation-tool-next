import { useCallback, useEffect, useState } from 'react'
import { ReservationRepository, type DemoSnapshot } from '../domain'
import { subscribeToDemoChanges } from './demoSync'

const repository = new ReservationRepository({ databaseName: 'reservation-management-public-demo' })

type DemoDataState = {
  snapshot?: DemoSnapshot
  loading: boolean
  error?: string
  refresh: () => Promise<void>
}

export function demoDataLoadErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.includes('別の画面がデータベース更新を妨げています')) {
    return '別のタブで旧版のデモ画面が開かれています。旧版のタブをすべて閉じてから、この画面を再読み込みしてください。'
  }
  return 'ブラウザ内のデモデータを読み込めませんでした。再読み込みしてお試しください。'
}

export function useDemoData(scope: 'public' | 'admin' | 'driver' = 'public'): DemoDataState {
  const [snapshot, setSnapshot] = useState<DemoSnapshot>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    setSnapshot(await repository.snapshot(scope))
  }, [scope])

  useEffect(() => {
    let active = true
    const initialize = async () => {
      try {
        await repository.ensureInitialized()
        const next = await repository.snapshot(scope)
        if (active) setSnapshot(next)
      } catch (error) {
        if (active) setError(demoDataLoadErrorMessage(error))
      } finally {
        if (active) setLoading(false)
      }
    }
    void initialize()
    return () => { active = false }
  }, [scope])

  useEffect(() => {
    const reload = () => { void refresh().catch(() => setError('最新のデモデータを読み込めませんでした。')) }
    const unsubscribe = subscribeToDemoChanges(reload)
    const onVisibility = () => { if (document.visibilityState === 'visible') reload() }
    window.addEventListener('focus', reload)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      unsubscribe()
      window.removeEventListener('focus', reload)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refresh])

  return { snapshot, loading, error, refresh }
}

export { repository as demoRepository }
