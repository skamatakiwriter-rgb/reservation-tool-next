export const DATABASE_VERSION = 2
export const SCHEMA_VERSION = 2
export const SEED_VERSION = '2026-09-27.1'

export const storeNames = {
  metadata: 'metadata',
  reservations: 'reservations',
  settings: 'settings',
  closures: 'closures',
  auditLogs: 'auditLogs',
  idempotency: 'idempotency',
  vehicles: 'vehicles',
  drivers: 'drivers',
  dispatchAssignments: 'dispatchAssignments',
  internalNotes: 'internalNotes',
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
  if (!database.objectStoreNames.contains(storeNames.vehicles)) {
    const vehicles = database.createObjectStore(storeNames.vehicles, { keyPath: 'vehicleId' })
    vehicles.createIndex('byVehicleCode', 'vehicleCode', { unique: true })
  }
  if (!database.objectStoreNames.contains(storeNames.drivers)) {
    const drivers = database.createObjectStore(storeNames.drivers, { keyPath: 'driverId' })
    drivers.createIndex('byDriverCode', 'driverCode', { unique: true })
  }
  if (!database.objectStoreNames.contains(storeNames.dispatchAssignments)) {
    const assignments = database.createObjectStore(storeNames.dispatchAssignments, { keyPath: 'dispatchId' })
    assignments.createIndex('byReservationId', 'reservationId')
    assignments.createIndex('byReservationAttempt', ['reservationId', 'attemptNumber'], { unique: true })
    assignments.createIndex('byPlannedDate', 'plannedDate')
    assignments.createIndex('byStatus', 'status')
    assignments.createIndex('byVehicleDate', ['vehicleId', 'plannedDate'])
    assignments.createIndex('byDriverDate', ['primaryDriverId', 'plannedDate'])
  }
  if (!database.objectStoreNames.contains(storeNames.internalNotes)) {
    const notes = database.createObjectStore(storeNames.internalNotes, { keyPath: 'noteId' })
    notes.createIndex('byReservationCreatedAt', ['reservationId', 'createdAt'])
  }
}
