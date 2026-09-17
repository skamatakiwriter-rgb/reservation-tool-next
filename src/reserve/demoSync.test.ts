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
})
