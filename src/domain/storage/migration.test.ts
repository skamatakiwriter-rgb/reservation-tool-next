import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it } from 'vitest'
import type { DemoMetadata, IdempotencyRecord } from '../types'
import { deleteReservationDatabase, openReservationDatabase, requestResult, transactionDone } from './idb'
import { ReservationRepository } from './repository'
import { createSeedData } from './seed'
import { DATABASE_VERSION, SCHEMA_VERSION, SEED_VERSION, storeNames } from './schema'

const names: string[] = []
const now = '2026-09-16T01:00:00.000Z'
const today = '2026-09-16'

afterEach(async () => {
  for (const name of names.splice(0)) await deleteReservationDatabase(name)
})

function nameForTest(): string {
  const name = `migration-${crypto.randomUUID()}`
  names.push(name)
  return name
}

function repositoryFor(name: string): ReservationRepository {
  let sequence = 0
  return new ReservationRepository({
    databaseName: name,
    now: () => new Date(now),
    today: () => today,
    createId: () => `migration-id-${++sequence}`,
  })
}

async function createLegacyDatabase(name: string) {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      db.createObjectStore('metadata', { keyPath: 'key' })
      const reservations = db.createObjectStore('reservations', { keyPath: 'reservationId' })
      reservations.createIndex('byReservationCode', 'reservationCode', { unique: true })
      reservations.createIndex('byDateCategory', ['requestedDate', 'categoryId'])
      db.createObjectStore('settings', { keyPath: 'categoryId' })
      const closures = db.createObjectStore('closures', { keyPath: 'closureId' })
      closures.createIndex('byDateCategory', ['date', 'categoryId'], { unique: true })
      const auditLogs = db.createObjectStore('auditLogs', { keyPath: 'auditId' })
      auditLogs.createIndex('byEntity', ['entityType', 'entityId'])
      db.createObjectStore('idempotency', { keyPath: ['generationId', 'idempotencyKey'] })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

  const seed = createSeedData(today, now, 'preserved-generation')
  const metadata: DemoMetadata = { ...seed.metadata, schemaVersion: 1, seedVersion: '2026-09-18.3' }
  const transaction = database.transaction(Array.from(database.objectStoreNames), 'readwrite')
  const done = transactionDone(transaction)
  transaction.objectStore('metadata').add(metadata)
  seed.reservations.forEach((item) => transaction.objectStore('reservations').add(item))
  seed.settings.forEach((item) => transaction.objectStore('settings').add(item))
  seed.closures.forEach((item) => transaction.objectStore('closures').add(item))
  seed.auditLogs.forEach((item) => transaction.objectStore('auditLogs').add(item))
  const idempotency: IdempotencyRecord = {
    generationId: metadata.generationId,
    idempotencyKey: 'preserved-key',
    requestFingerprint: 'preserved-fingerprint',
    operation: 'createReservation',
    resultKind: 'success',
    resultPayload: { generationId: metadata.generationId },
    createdAt: now,
  }
  transaction.objectStore('idempotency').add(idempotency)
  await done
  database.close()
  return { seed, metadata, idempotency }
}

describe('Ver1からVer2への保存データ移行', () => {
  it('既存6ストアと保存内容を維持し、車両・担当者と監査記録だけを追加する', async () => {
    const name = nameForTest()
    const legacy = await createLegacyDatabase(name)
    const repository = repositoryFor(name)
    const result = await repository.ensureInitialized()
    const snapshot = await repository.snapshot()

    expect(result.kind).toBe('retained')
    expect(result.metadata).toMatchObject({ generationId: legacy.metadata.generationId, schemaVersion: SCHEMA_VERSION, seedVersion: SEED_VERSION })
    expect(snapshot.reservations).toEqual(legacy.seed.reservations)
    expect(snapshot.settings).toEqual([...legacy.seed.settings].sort((a, b) => a.categoryId.localeCompare(b.categoryId)))
    expect(snapshot.closures).toEqual(legacy.seed.closures)
    expect(snapshot.auditLogs).toHaveLength(legacy.seed.auditLogs.length + 1)
    expect(snapshot.auditLogs).toContainEqual(expect.objectContaining({ action: 'schemaMigrated', before: { schemaVersion: 1 }, after: { schemaVersion: 2 } }))
    expect(await repository.findOperationResult(legacy.metadata.generationId, 'preserved-key')).toEqual(legacy.idempotency)
    expect(snapshot.vehicles.map((item) => item.vehicleCode)).toEqual(['VEH-DEMO-001', 'VEH-DEMO-002', 'VEH-DEMO-003'])
    expect(snapshot.drivers.map((item) => item.driverCode)).toEqual(['DRV-DEMO-001', 'DRV-DEMO-002', 'DRV-DEMO-003'])
    expect(snapshot.dispatchAssignments).toEqual([])
    expect(snapshot.internalNotes).toEqual([])

    await repository.ensureInitialized()
    expect((await repository.snapshot()).auditLogs).toHaveLength(legacy.seed.auditLogs.length + 1)
    repository.close()

    const database = await openReservationDatabase(name)
    expect(database.version).toBe(DATABASE_VERSION)
    expect(Array.from(database.objectStoreNames)).toHaveLength(10)
    const transaction = database.transaction(storeNames.dispatchAssignments, 'readonly')
    expect(Array.from(transaction.objectStore(storeNames.dispatchAssignments).indexNames)).toEqual([
      'byDriverDate', 'byPlannedDate', 'byReservationAttempt', 'byReservationId', 'byStatus', 'byVehicleDate',
    ])
    database.close()
  })

  it('シード版だけが異なる場合、使用中のデータを初期化しない', async () => {
    const name = nameForTest()
    const repository = repositoryFor(name)
    const initialized = await repository.ensureInitialized()
    const database = await openReservationDatabase(name)
    const transaction = database.transaction(storeNames.metadata, 'readwrite')
    const done = transactionDone(transaction)
    const metadata = await requestResult(transaction.objectStore(storeNames.metadata).get('demo')) as DemoMetadata
    transaction.objectStore(storeNames.metadata).put({ ...metadata, seedVersion: 'older-seed' })
    await done
    database.close()

    const retained = await repository.ensureInitialized()
    expect(retained.kind).toBe('retained')
    expect(retained.metadata.generationId).toBe(initialized.metadata.generationId)
    expect((await repository.snapshot()).reservations).toHaveLength(9)
    repository.close()
  })
})
