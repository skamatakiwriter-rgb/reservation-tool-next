import { describe, expect, it } from 'vitest'
import { demoDataLoadErrorMessage } from './useDemoData'

describe('デモデータ読込エラー', () => {
  it('旧版タブがDB更新を妨げている場合は閉じる操作を案内する', () => {
    expect(demoDataLoadErrorMessage(new Error('別の画面がデータベース更新を妨げています。'))).toBe(
      '別のタブで旧版のデモ画面が開かれています。旧版のタブをすべて閉じてから、この画面を再読み込みしてください。',
    )
  })

  it('その他の読込失敗では一般的な再読込案内を返す', () => {
    expect(demoDataLoadErrorMessage(new Error('unavailable'))).toBe(
      'ブラウザ内のデモデータを読み込めませんでした。再読み込みしてお試しください。',
    )
  })
})
