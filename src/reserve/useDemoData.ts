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

export function useDemoData(): DemoDataState {
  const [snapshot, setSnapshot] = useState<DemoSnapshot>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    setSnapshot(await repository.snapshot())
  }, [])

  useEffect(() => {
    let active = true
    const initialize = async () => {
      try {
        await repository.ensureInitialized()
        const next = await repository.snapshot()
        if (active) setSnapshot(next)
      } catch {
        if (active) setError('ブラウザ内のデモデータを読み込めませんでした。再読み込みしてお試しください。')
      } finally {
        if (active) setLoading(false)
      }
    }
    void initialize()
    return () => { active = false }
  }, [])

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
