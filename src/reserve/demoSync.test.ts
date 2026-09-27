import { describe, expect, it, vi } from 'vitest'
import { publishDemoChange, subscribeToDemoChanges } from './demoSync'

describe('デモデータ同期通知', () => {
  it('同じタブ内の購読者へ変更種別と対象を通知し、解除後は通知しない', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToDemoChanges(listener)
    publishDemoChange('reservation', 'reservation-1')
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'reservation', targetId: 'reservation-1' }))
    unsubscribe()
    publishDemoChange('setting', 'kagu')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it.each(['dispatch', 'dispatchStatus', 'internalNote', 'vehicle', 'driver'] as const)('%sの通知は種別・対象ID・時刻だけを含む', (type) => {
    const listener = vi.fn()
    const unsubscribe = subscribeToDemoChanges(listener)
    publishDemoChange(type, `${type}-1`)
    const change = listener.mock.calls.at(-1)?.[0]
    expect(Object.keys(change).sort()).toEqual(['occurredAt', 'targetId', 'type'])
    expect(change).toMatchObject({ type, targetId: `${type}-1` })
    expect(new Date(change.occurredAt).toString()).not.toBe('Invalid Date')
    expect(JSON.stringify(change)).not.toContain('電話')
    expect(JSON.stringify(change)).not.toContain('住所')
    unsubscribe()
  })
})
