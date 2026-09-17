import { describe, expect, it } from 'vitest'
import { availableTransitions, canTransition, initialStatus } from './statusRules'

describe('登録時の状態', () => {
  it('蛍光管は経路によらず確定になる', () => {
    expect(initialStatus('keikoukan', 'public')).toBe('confirmed')
    expect(initialStatus('keikoukan', 'admin', false)).toBe('confirmed')
  })

  it('家具家財とビン缶の公開申込みは受付になる', () => {
    expect(initialStatus('kagu', 'public')).toBe('received')
    expect(initialStatus('binkan', 'public')).toBe('received')
  })

  it('管理者確認済みの場合だけ確定になる', () => {
    expect(initialStatus('kagu', 'admin', false)).toBe('received')
    expect(initialStatus('kagu', 'admin', true)).toBe('confirmed')
  })
})

describe('状態遷移', () => {
  it('受付から確定または取消へ進める', () => {
    expect(availableTransitions('received')).toEqual(['confirmed', 'cancelled'])
  })

  it('確定から完了または取消へ進める', () => {
    expect(availableTransitions('confirmed')).toEqual(['completed', 'cancelled'])
  })

  it('完了と取消は終端状態', () => {
    expect(availableTransitions('completed')).toEqual([])
    expect(availableTransitions('cancelled')).toEqual([])
    expect(canTransition('completed', 'confirmed')).toBe(false)
  })
})
