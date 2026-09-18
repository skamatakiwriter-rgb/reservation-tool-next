export const DATABASE_VERSION = 1
export const SCHEMA_VERSION = 1
export const SEED_VERSION = '2026-09-18.3'

export const storeNames = {
  metadata: 'metadata',
  reservations: 'reservations',
  settings: 'settings',
  closures: 'closures',
  auditLogs: 'auditLogs',
  idempotency: 'idempotency',
} as const

export const allStoreNames = Object.values(storeNames)

export function upgradeSchema(database: IDBDatabase) {
  if (!database.objectStoreNames.contains(storeNames.metadata)) {
    database.createObjectStore(storeNames.metadata, { keyPath: 'key' })
  }
  if (!database.objectStoreNames.contains(storeNames.reservations)) {
    const reservations = database.createObjectStore(storeNames.reservations, { keyPath: 'reservationId' })
    reservations.createIndex('byReservationCode', 'reservationCode', { unique: true })
    reservations.createIndex('byDateCategory', ['requestedDate', 'categoryId'])
  }
  if (!database.objectStoreNames.contains(storeNames.settings)) {
    database.createObjectStore(storeNames.settings, { keyPath: 'categoryId' })
  }
  if (!database.objectStoreNames.contains(storeNames.closures)) {
    const closures = database.createObjectStore(storeNames.closures, { keyPath: 'closureId' })
    closures.createIndex('byDateCategory', ['date', 'categoryId'], { unique: true })
  }
  if (!database.objectStoreNames.contains(storeNames.auditLogs)) {
    const auditLogs = database.createObjectStore(storeNames.auditLogs, { keyPath: 'auditId' })
    auditLogs.createIndex('byEntity', ['entityType', 'entityId'])
  }
  if (!database.objectStoreNames.contains(storeNames.idempotency)) {
    database.createObjectStore(storeNames.idempotency, { keyPath: ['generationId', 'idempotencyKey'] })
  }
}
