import { DATABASE_VERSION, upgradeSchema } from './schema'

export function openReservationDatabase(databaseName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, DATABASE_VERSION)
    request.onupgradeneeded = () => upgradeSchema(request.result)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('データベースを開けませんでした。'))
    request.onblocked = () => reject(new Error('別の画面がデータベース更新を妨げています。'))
  })
}

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('データの読み書きに失敗しました。'))
  })
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('保存処理を中止しました。'))
    transaction.onerror = () => reject(transaction.error ?? new Error('保存処理に失敗しました。'))
  })
}

export function deleteReservationDatabase(databaseName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('テスト用データベースを削除できませんでした。'))
    request.onblocked = () => reject(new Error('データベースが使用中です。'))
  })
}
