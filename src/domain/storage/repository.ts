import { evaluateAvailability } from '../availability'
import { todayInJapan } from '../dateRules'
import { initialStatus, canTransition } from '../statusRules'
import type {
  Actor,
  AuditLog,
  CategorySetting,
  Closure,
  DemoMetadata,
  IdempotencyRecord,
  OperationResultPayload,
  RegistrationChannel,
  Reservation,
  ReservationInput,
  ReservationStatus,
} from '../types'
import { normalizePhoneNumber, validateReservationInput } from '../validation'
import { fingerprint } from './fingerprint'
import { openReservationDatabase, requestResult, transactionDone } from './idb'
import { createSeedData } from './seed'
import { allStoreNames, SCHEMA_VERSION, SEED_VERSION, storeNames } from './schema'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export type DemoSnapshot = {
  metadata: DemoMetadata | undefined
  reservations: Reservation[]
  settings: CategorySetting[]
  closures: Closure[]
  auditLogs: AuditLog[]
}

export type InitializationResult = {
  kind: 'initialized' | 'retained'
  metadata: DemoMetadata
}

export type SaveResult =
  | { kind: 'success' | 'duplicateSuccess'; payload: OperationResultPayload }
  | { kind: 'validationError'; errors: ReturnType<typeof validateReservationInput> }
  | { kind: 'capacityFull' | 'closed' | 'zeroLimit' | 'invalidSetting' | 'dateUnavailable' }
  | { kind: 'versionConflict' | 'staleGeneration' | 'idempotencyConflict' | 'invalidTransition' | 'notFound' }
  | { kind: 'storageFull' | 'storageUnavailable'; message: string }

export type CreateReservationCommand = {
  generationId: string
  idempotencyKey: string
  channel: RegistrationChannel
  actor: Actor
  input: ReservationInput
  detailsConfirmed?: boolean
  allowFullCapacityOverride?: boolean
  sourceReservationId?: string
  relatedReservation?: Pick<Reservation, 'workGroupId' | 'workGroupCode' | 'reservationId'>
}

export type ChangeStatusCommand = {
  generationId: string
  idempotencyKey: string
  actor: Actor
  reservationId: string
  expectedVersion: number
  nextStatus: ReservationStatus
  cancelReason?: string
}

export type UpdateReservationCommand = {
  generationId: string
  idempotencyKey: string
  actor: Actor
  reservationId: string
  expectedVersion: number
  input: ReservationInput
  allowFullCapacityOverride?: boolean
}

export type UpdateCategoryLimitCommand = {
  generationId: string
  idempotencyKey: string
  actor: Actor
  categoryId: Reservation['categoryId']
  expectedVersion: number
  dailyLimit: number
}

export type SetClosureCommand = {
  generationId: string
  idempotencyKey: string
  actor: Actor
  date: string
  categoryId: Reservation['categoryId']
  expectedVersion?: number
  isClosed: boolean
}

type RepositoryOptions = {
  databaseName: string
  now?: () => Date
  today?: () => string
  createId?: () => string
}

export class ReservationRepository {
  private readonly databaseName: string
  private readonly now: () => Date
  private readonly today: () => string
  private readonly createId: () => string
  private database?: IDBDatabase

  constructor(options: RepositoryOptions) {
    this.databaseName = options.databaseName
    this.now = options.now ?? (() => new Date())
    this.today = options.today ?? (() => todayInJapan(this.now()))
    this.createId = options.createId ?? (() => crypto.randomUUID())
  }

  async open(): Promise<void> {
    if (!this.database) this.database = await openReservationDatabase(this.databaseName)
  }

  close(): void {
    this.database?.close()
    this.database = undefined
  }

  async ensureInitialized(): Promise<InitializationResult> {
    const database = await this.getDatabase()
    const transaction = database.transaction(allStoreNames, 'readwrite')
    const done = transactionDone(transaction)
    const metadataStore = transaction.objectStore(storeNames.metadata)
    const current = await requestResult(metadataStore.get('demo')) as DemoMetadata | undefined
    const now = this.now().toISOString()
    const expired = current?.lifecycleState === 'active'
      && this.now().getTime() - new Date(current.lastUsedAt).getTime() > SEVEN_DAYS_MS

    if (current?.lifecycleState === 'active' && !expired && current.schemaVersion === SCHEMA_VERSION && current.seedVersion === SEED_VERSION) {
      const updated = { ...current, lastUsedAt: now, updatedAt: now }
      metadataStore.put(updated)
      await done
      return { kind: 'retained', metadata: updated }
    }

    const metadata = await this.replaceWithSeed(transaction, now)
    await done
    return { kind: 'initialized', metadata }
  }

  async resetDemoData(expectedGenerationId: string): Promise<SaveResult> {
    return this.executeSave(() => this.resetDemoDataUnsafe(expectedGenerationId))
  }

  private async resetDemoDataUnsafe(expectedGenerationId: string): Promise<SaveResult> {
    const database = await this.getDatabase()
    const transaction = database.transaction(allStoreNames, 'readwrite')
    const done = transactionDone(transaction)
    const metadata = await this.getMetadata(transaction)
    if (!isCurrentGeneration(metadata, expectedGenerationId)) {
      transaction.abort()
      await ignoreAbort(done)
      return { kind: 'staleGeneration' }
    }
    const next = await this.replaceWithSeed(transaction, this.now().toISOString())
    await done
    return { kind: 'success', payload: { generationId: next.generationId } }
  }

  async deleteDemoData(expectedGenerationId: string): Promise<SaveResult> {
    return this.executeSave(() => this.deleteDemoDataUnsafe(expectedGenerationId))
  }

  private async deleteDemoDataUnsafe(expectedGenerationId: string): Promise<SaveResult> {
    const database = await this.getDatabase()
    const transaction = database.transaction(allStoreNames, 'readwrite')
    const done = transactionDone(transaction)
    const metadata = await this.getMetadata(transaction)
    if (!isCurrentGeneration(metadata, expectedGenerationId)) {
      transaction.abort()
      await ignoreAbort(done)
      return { kind: 'staleGeneration' }
    }

    await this.clearBusinessStores(transaction)
    const now = this.now().toISOString()
    const deletedMetadata: DemoMetadata = {
      key: 'demo',
      schemaVersion: SCHEMA_VERSION,
      seedVersion: SEED_VERSION,
      generationId: this.createId(),
      lifecycleState: 'deleted',
      lastUsedAt: now,
      updatedAt: now,
    }
    transaction.objectStore(storeNames.metadata).put(deletedMetadata)
    await done
    return { kind: 'success', payload: { generationId: deletedMetadata.generationId } }
  }

  async createReservation(command: CreateReservationCommand): Promise<SaveResult> {
    return this.executeSave(() => this.createReservationUnsafe(command))
  }

  private async createReservationUnsafe(command: CreateReservationCommand): Promise<SaveResult> {
    const database = await this.getDatabase()
    const requestFingerprint = fingerprint({
      operation: 'createReservation',
      channel: command.channel,
      input: command.input,
      detailsConfirmed: command.detailsConfirmed ?? false,
      allowFullCapacityOverride: command.allowFullCapacityOverride ?? false,
      sourceReservationId: command.sourceReservationId,
      relatedReservationId: command.relatedReservation?.reservationId,
    })
    const transaction = database.transaction(allStoreNames, 'readwrite')
    const done = transactionDone(transaction)
    const metadata = await this.getMetadata(transaction)
    if (!isCurrentGeneration(metadata, command.generationId)) {
      transaction.abort()
      await ignoreAbort(done)
      return { kind: 'staleGeneration' }
    }

    const replay = await this.replayResult(transaction, command.generationId, command.idempotencyKey, requestFingerprint)
    if (replay) {
      transaction.abort()
      await ignoreAbort(done)
      return replay
    }

    const setting = await requestResult(transaction.objectStore(storeNames.settings).get(command.input.categoryId)) as CategorySetting | undefined
    const closure = await requestResult(
      transaction.objectStore(storeNames.closures).index('byDateCategory').get([command.input.requestedDate, command.input.categoryId]),
    ) as Closure | undefined
    const reservations = await requestResult(transaction.objectStore(storeNames.reservations).getAll()) as Reservation[]
    const sourceReservation = command.sourceReservationId
      ? reservations.find((item) => item.reservationId === command.sourceReservationId)
      : undefined
    const reacceptSource = sourceReservation?.status === 'cancelled' ? sourceReservation : undefined
    const availability = evaluateAvailability({
      requestedDate: command.input.requestedDate,
      categoryId: command.input.categoryId,
      channel: command.channel,
      today: this.today(),
      setting,
      isClosed: closure?.isClosed === true,
      reservations,
    })

    if (!availability.available) {
      const canOverride = command.channel === 'admin'
        && availability.reason === 'full'
        && command.allowFullCapacityOverride === true
      if (!canOverride) {
        transaction.abort()
        await ignoreAbort(done)
        return { kind: mapAvailabilityFailure(availability.reason) }
      }
    }

    const errors = validateReservationInput(command.input, { channel: command.channel, today: this.today() })
    if (errors.length > 0) {
      transaction.abort()
      await ignoreAbort(done)
      return { kind: 'validationError', errors }
    }

    const now = this.now().toISOString()
    const reservationId = this.createId()
    const groupId = command.relatedReservation?.workGroupId ?? this.createId()
    const groupCode = command.relatedReservation?.workGroupCode ?? makeReadableCode('GROUP', groupId)
    const status = command.relatedReservation
      ? 'confirmed'
      : initialStatus(command.input.categoryId, command.channel, command.detailsConfirmed)
    const reservation: Reservation = {
      reservationId,
      reservationCode: makeReadableCode('R', reservationId),
      workGroupId: groupId,
      workGroupCode: groupCode,
      categoryId: command.input.categoryId,
      requestedDate: command.input.requestedDate,
      status,
      companyName: command.input.companyName.trim(),
      contactName: command.input.contactName.trim(),
      phoneDisplay: command.input.phone.trim(),
      phoneNormalized: normalizePhoneNumber(command.input.phone),
      address: command.input.categoryId === 'keikoukan' ? undefined : command.input.address?.trim(),
      contactNotes: command.input.contactNotes ?? '',
      categoryAnswers: command.input.categoryAnswers,
      createdAt: now,
      createdBy: command.actor,
      updatedAt: now,
      version: 1,
      sourceReservationId: command.sourceReservationId,
      overrideType: !availability.available && availability.reason === 'full' ? 'fullCapacity' : undefined,
    }
    if (status === 'confirmed') {
      reservation.confirmedAt = now
      reservation.confirmedBy = command.actor
    }

    const payload: OperationResultPayload = {
      reservationId,
      reservationCode: reservation.reservationCode,
      version: 1,
      generationId: metadata.generationId,
    }
    const audit: AuditLog = {
      auditId: this.createId(),
      entityType: 'reservation',
      entityId: reservationId,
      action: command.relatedReservation ? 'relatedDateAdded' : reacceptSource ? 'reaccepted' : 'created',
      after: { status, requestedDate: reservation.requestedDate, categoryId: reservation.categoryId },
      actor: command.actor,
      occurredAt: now,
      relatedReservationId: command.relatedReservation?.reservationId ?? reacceptSource?.reservationId,
      note: reservation.overrideType === 'fullCapacity' ? `例外受付（変更前件数${availability.currentCount}、上限${availability.dailyLimit}）` : undefined,
    }
    const idempotency: IdempotencyRecord = {
      generationId: metadata.generationId,
      idempotencyKey: command.idempotencyKey,
      requestFingerprint,
      operation: 'createReservation',
      resultKind: 'success',
      resultPayload: payload,
      createdAt: now,
    }

    transaction.objectStore(storeNames.reservations).add(reservation)
    const auditStore = transaction.objectStore(storeNames.auditLogs)
    auditStore.add(audit)
    if (reacceptSource) {
      auditStore.add({
        auditId: this.createId(),
        entityType: 'reservation',
        entityId: reacceptSource.reservationId,
        action: 'reacceptedAs',
        after: { reservationId, reservationCode: reservation.reservationCode, requestedDate: reservation.requestedDate },
        actor: command.actor,
        occurredAt: now,
        relatedReservationId: reservationId,
      } satisfies AuditLog)
    }
    transaction.objectStore(storeNames.idempotency).add(idempotency)
    transaction.objectStore(storeNames.metadata).put({ ...metadata, lastUsedAt: now, updatedAt: now })
    await done
    return { kind: 'success', payload }
  }

  async changeStatus(command: ChangeStatusCommand): Promise<SaveResult> {
    return this.executeSave(() => this.changeStatusUnsafe(command))
  }

  private async changeStatusUnsafe(command: ChangeStatusCommand): Promise<SaveResult> {
    const database = await this.getDatabase()
    const requestFingerprint = fingerprint({ operation: 'changeStatus', ...command })
    const transaction = database.transaction(allStoreNames, 'readwrite')
    const done = transactionDone(transaction)
    const metadata = await this.getMetadata(transaction)
    if (!isCurrentGeneration(metadata, command.generationId)) {
      transaction.abort()
      await ignoreAbort(done)
      return { kind: 'staleGeneration' }
    }
    const replay = await this.replayResult(transaction, command.generationId, command.idempotencyKey, requestFingerprint)
    if (replay) {
      transaction.abort()
      await ignoreAbort(done)
      return replay
    }

    const store = transaction.objectStore(storeNames.reservations)
    const reservation = await requestResult(store.get(command.reservationId)) as Reservation | undefined
    if (!reservation) {
      transaction.abort()
      await ignoreAbort(done)
      return { kind: 'notFound' }
    }
    if (reservation.version !== command.expectedVersion) {
      transaction.abort()
      await ignoreAbort(done)
      return { kind: 'versionConflict' }
    }
    if (!canTransition(reservation.status, command.nextStatus)) {
      transaction.abort()
      await ignoreAbort(done)
      return { kind: 'invalidTransition' }
    }

    const now = this.now().toISOString()
    const beforeStatus = reservation.status
    const updated: Reservation = { ...reservation, status: command.nextStatus, updatedAt: now, version: reservation.version + 1 }
    if (command.nextStatus === 'confirmed') {
      updated.confirmedAt = now
      updated.confirmedBy = command.actor
    } else if (command.nextStatus === 'completed') {
      updated.completedAt = now
      updated.completedBy = command.actor
    } else if (command.nextStatus === 'cancelled') {
      updated.cancelledAt = now
      updated.cancelledBy = command.actor
      updated.cancelReason = command.cancelReason?.trim() || undefined
    }

    const payload: OperationResultPayload = {
      reservationId: updated.reservationId,
      reservationCode: updated.reservationCode,
      version: updated.version,
      generationId: metadata.generationId,
    }
    const idempotency: IdempotencyRecord = {
      generationId: metadata.generationId,
      idempotencyKey: command.idempotencyKey,
      requestFingerprint,
      operation: 'changeStatus',
      targetEntityId: updated.reservationId,
      resultKind: 'success',
      resultPayload: payload,
      createdAt: now,
    }
    const audit: AuditLog = {
      auditId: this.createId(),
      entityType: 'reservation',
      entityId: updated.reservationId,
      action: command.nextStatus,
      before: { status: beforeStatus },
      after: { status: command.nextStatus },
      actor: command.actor,
      occurredAt: now,
      note: command.nextStatus === 'cancelled' ? updated.cancelReason : undefined,
    }

    store.put(updated)
    transaction.objectStore(storeNames.auditLogs).add(audit)
    transaction.objectStore(storeNames.idempotency).add(idempotency)
    transaction.objectStore(storeNames.metadata).put({ ...metadata, lastUsedAt: now, updatedAt: now })
    await done
    return { kind: 'success', payload }
  }

  async updateReservation(command: UpdateReservationCommand): Promise<SaveResult> {
    return this.executeSave(() => this.updateReservationUnsafe(command))
  }

  private async updateReservationUnsafe(command: UpdateReservationCommand): Promise<SaveResult> {
    const database = await this.getDatabase()
    const requestFingerprint = fingerprint({ operation: 'updateReservation', ...command })
    const transaction = database.transaction(allStoreNames, 'readwrite')
    const done = transactionDone(transaction)
    const metadata = await this.getMetadata(transaction)
    if (!isCurrentGeneration(metadata, command.generationId)) return abortResult(transaction, done, 'staleGeneration')
    const replay = await this.replayResult(transaction, command.generationId, command.idempotencyKey, requestFingerprint)
    if (replay) {
      transaction.abort()
      await ignoreAbort(done)
      return replay
    }

    const store = transaction.objectStore(storeNames.reservations)
    const current = await requestResult(store.get(command.reservationId)) as Reservation | undefined
    if (!current) return abortResult(transaction, done, 'notFound')
    if (current.version !== command.expectedVersion) return abortResult(transaction, done, 'versionConflict')
    if (current.status === 'completed' || current.status === 'cancelled') return abortResult(transaction, done, 'invalidTransition')

    const errors = validateReservationInput(command.input, { channel: 'admin', today: this.today() })
    const dateOrCategoryChanged = current.requestedDate !== command.input.requestedDate || current.categoryId !== command.input.categoryId
    if (errors.length > 0 && dateOrCategoryChanged) return abortValidation(transaction, done, errors)
    const contentErrors = errors.filter((error) => error.field !== 'requestedDate')
    if (contentErrors.length > 0) return abortValidation(transaction, done, contentErrors)

    let overrideType = current.overrideType
    if (dateOrCategoryChanged) {
      const setting = await requestResult(transaction.objectStore(storeNames.settings).get(command.input.categoryId)) as CategorySetting | undefined
      const closure = await requestResult(transaction.objectStore(storeNames.closures).index('byDateCategory').get([command.input.requestedDate, command.input.categoryId])) as Closure | undefined
      const reservations = await requestResult(store.getAll()) as Reservation[]
      const availability = evaluateAvailability({ requestedDate: command.input.requestedDate, categoryId: command.input.categoryId, channel: 'admin', today: this.today(), setting, isClosed: closure?.isClosed === true, reservations, excludeReservationId: current.reservationId })
      if (!availability.available) {
        const canOverride = availability.reason === 'full' && command.allowFullCapacityOverride === true
        if (!canOverride) return abortResult(transaction, done, mapAvailabilityFailure(availability.reason))
        overrideType = 'fullCapacity'
      } else {
        overrideType = undefined
      }
    }

    const now = this.now().toISOString()
    const updated: Reservation = {
      ...current,
      categoryId: command.input.categoryId,
      requestedDate: command.input.requestedDate,
      companyName: command.input.companyName.trim(),
      contactName: command.input.contactName.trim(),
      phoneDisplay: command.input.phone.trim(),
      phoneNormalized: normalizePhoneNumber(command.input.phone),
      address: command.input.categoryId === 'keikoukan' ? undefined : command.input.address?.trim(),
      contactNotes: command.input.contactNotes ?? '',
      categoryAnswers: command.input.categoryAnswers,
      overrideType,
      updatedAt: now,
      version: current.version + 1,
    }
    const payload: OperationResultPayload = { reservationId: updated.reservationId, reservationCode: updated.reservationCode, version: updated.version, generationId: metadata.generationId }
    store.put(updated)
    transaction.objectStore(storeNames.auditLogs).add({ auditId: this.createId(), entityType: 'reservation', entityId: updated.reservationId, action: 'updated', before: reservationAuditValue(current), after: reservationAuditValue(updated), actor: command.actor, occurredAt: now } satisfies AuditLog)
    transaction.objectStore(storeNames.idempotency).add(makeIdempotency(metadata.generationId, command.idempotencyKey, requestFingerprint, 'updateReservation', payload, now, updated.reservationId))
    transaction.objectStore(storeNames.metadata).put({ ...metadata, lastUsedAt: now, updatedAt: now })
    await done
    return { kind: 'success', payload }
  }

  async updateCategoryLimit(command: UpdateCategoryLimitCommand): Promise<SaveResult> {
    return this.executeSave(() => this.updateCategoryLimitUnsafe(command))
  }

  private async updateCategoryLimitUnsafe(command: UpdateCategoryLimitCommand): Promise<SaveResult> {
    const database = await this.getDatabase()
    const requestFingerprint = fingerprint({ operation: 'updateCategoryLimit', ...command })
    const transaction = database.transaction(allStoreNames, 'readwrite')
    const done = transactionDone(transaction)
    const metadata = await this.getMetadata(transaction)
    if (!isCurrentGeneration(metadata, command.generationId)) return abortResult(transaction, done, 'staleGeneration')
    const replay = await this.replayResult(transaction, command.generationId, command.idempotencyKey, requestFingerprint)
    if (replay) { transaction.abort(); await ignoreAbort(done); return replay }
    if (!Number.isInteger(command.dailyLimit) || command.dailyLimit < 0) return abortResult(transaction, done, 'invalidSetting')
    const store = transaction.objectStore(storeNames.settings)
    const current = await requestResult(store.get(command.categoryId)) as CategorySetting | undefined
    if (!current || current.version !== command.expectedVersion) return abortResult(transaction, done, current ? 'versionConflict' : 'invalidSetting')
    const now = this.now().toISOString()
    const updated: CategorySetting = { ...current, dailyLimit: command.dailyLimit, version: command.expectedVersion + 1, updatedAt: now, updatedBy: command.actor }
    const payload: OperationResultPayload = { version: updated.version, generationId: metadata.generationId }
    store.put(updated)
    transaction.objectStore(storeNames.auditLogs).add({ auditId: this.createId(), entityType: 'categorySetting', entityId: command.categoryId, action: 'limitChanged', before: { dailyLimit: current.dailyLimit }, after: { dailyLimit: command.dailyLimit }, actor: command.actor, occurredAt: now } satisfies AuditLog)
    transaction.objectStore(storeNames.idempotency).add(makeIdempotency(metadata.generationId, command.idempotencyKey, requestFingerprint, 'updateCategoryLimit', payload, now, command.categoryId))
    transaction.objectStore(storeNames.metadata).put({ ...metadata, lastUsedAt: now, updatedAt: now })
    await done
    return { kind: 'success', payload }
  }

  async setClosure(command: SetClosureCommand): Promise<SaveResult> {
    return this.executeSave(() => this.setClosureUnsafe(command))
  }

  private async setClosureUnsafe(command: SetClosureCommand): Promise<SaveResult> {
    const database = await this.getDatabase()
    const requestFingerprint = fingerprint({ operation: 'setClosure', ...command })
    const transaction = database.transaction(allStoreNames, 'readwrite')
    const done = transactionDone(transaction)
    const metadata = await this.getMetadata(transaction)
    if (!isCurrentGeneration(metadata, command.generationId)) return abortResult(transaction, done, 'staleGeneration')
    const replay = await this.replayResult(transaction, command.generationId, command.idempotencyKey, requestFingerprint)
    if (replay) { transaction.abort(); await ignoreAbort(done); return replay }
    const store = transaction.objectStore(storeNames.closures)
    const current = await requestResult(store.index('byDateCategory').get([command.date, command.categoryId])) as Closure | undefined
    if ((current?.version ?? undefined) !== command.expectedVersion) return abortResult(transaction, done, 'versionConflict')
    const now = this.now().toISOString()
    const updated: Closure = current
      ? { ...current, isClosed: command.isClosed, version: current.version + 1, updatedAt: now, updatedBy: command.actor }
      : { closureId: this.createId(), date: command.date, categoryId: command.categoryId, isClosed: command.isClosed, version: 1, createdAt: now, createdBy: command.actor, updatedAt: now, updatedBy: command.actor }
    const payload: OperationResultPayload = { version: updated.version, generationId: metadata.generationId }
    store.put(updated)
    transaction.objectStore(storeNames.auditLogs).add({ auditId: this.createId(), entityType: 'closure', entityId: updated.closureId, action: command.isClosed ? 'closed' : 'reopened', before: current ? { isClosed: current.isClosed } : undefined, after: { date: command.date, categoryId: command.categoryId, isClosed: command.isClosed }, actor: command.actor, occurredAt: now } satisfies AuditLog)
    transaction.objectStore(storeNames.idempotency).add(makeIdempotency(metadata.generationId, command.idempotencyKey, requestFingerprint, 'setClosure', payload, now, updated.closureId))
    transaction.objectStore(storeNames.metadata).put({ ...metadata, lastUsedAt: now, updatedAt: now })
    await done
    return { kind: 'success', payload }
  }

  async findOperationResult(generationId: string, idempotencyKey: string): Promise<IdempotencyRecord | undefined> {
    const database = await this.getDatabase()
    const transaction = database.transaction(storeNames.idempotency, 'readonly')
    return await requestResult(transaction.objectStore(storeNames.idempotency).get([generationId, idempotencyKey])) as IdempotencyRecord | undefined
  }

  async snapshot(): Promise<DemoSnapshot> {
    const database = await this.getDatabase()
    const transaction = database.transaction(allStoreNames, 'readonly')
    const [metadata, reservations, settings, closures, auditLogs] = await Promise.all([
      requestResult(transaction.objectStore(storeNames.metadata).get('demo')),
      requestResult(transaction.objectStore(storeNames.reservations).getAll()),
      requestResult(transaction.objectStore(storeNames.settings).getAll()),
      requestResult(transaction.objectStore(storeNames.closures).getAll()),
      requestResult(transaction.objectStore(storeNames.auditLogs).getAll()),
    ])
    return {
      metadata: metadata as DemoMetadata | undefined,
      reservations: reservations as Reservation[],
      settings: settings as CategorySetting[],
      closures: closures as Closure[],
      auditLogs: auditLogs as AuditLog[],
    }
  }

  private async getDatabase(): Promise<IDBDatabase> {
    await this.open()
    if (!this.database) throw new Error('データベースを開けませんでした。')
    return this.database
  }

  private async getMetadata(transaction: IDBTransaction): Promise<DemoMetadata> {
    const metadata = await requestResult(transaction.objectStore(storeNames.metadata).get('demo')) as DemoMetadata | undefined
    if (!metadata) throw new Error('デモデータが初期化されていません。')
    return metadata
  }

  private async replayResult(
    transaction: IDBTransaction,
    generationId: string,
    idempotencyKey: string,
    requestFingerprint: string,
  ): Promise<SaveResult | undefined> {
    const record = await requestResult(
      transaction.objectStore(storeNames.idempotency).get([generationId, idempotencyKey]),
    ) as IdempotencyRecord | undefined
    if (!record) return undefined
    if (record.requestFingerprint !== requestFingerprint) return { kind: 'idempotencyConflict' }
    return { kind: 'duplicateSuccess', payload: record.resultPayload }
  }

  private async replaceWithSeed(transaction: IDBTransaction, now: string): Promise<DemoMetadata> {
    await Promise.all(allStoreNames.map((name) => requestResult(transaction.objectStore(name).clear())))
    const seed = createSeedData(this.today(), now, this.createId())
    transaction.objectStore(storeNames.metadata).add(seed.metadata)
    seed.reservations.forEach((reservation) => transaction.objectStore(storeNames.reservations).add(reservation))
    seed.settings.forEach((setting) => transaction.objectStore(storeNames.settings).add(setting))
    seed.closures.forEach((closure) => transaction.objectStore(storeNames.closures).add(closure))
    seed.auditLogs.forEach((audit) => transaction.objectStore(storeNames.auditLogs).add(audit))
    return seed.metadata
  }

  private async clearBusinessStores(transaction: IDBTransaction): Promise<void> {
    const businessStores = allStoreNames.filter((name) => name !== storeNames.metadata)
    await Promise.all(businessStores.map((name) => requestResult(transaction.objectStore(name).clear())))
  }

  private async executeSave(operation: () => Promise<SaveResult>): Promise<SaveResult> {
    try {
      return await operation()
    } catch (error) {
      return classifyStorageError(error)
    }
  }
}

export function classifyStorageError(error: unknown): Extract<SaveResult, { kind: 'storageFull' | 'storageUnavailable' }> {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return { kind: 'storageFull', message: 'ブラウザの保存容量が不足しています。入力内容を残したまま、空き容量を確認してください。' }
  }
  return { kind: 'storageUnavailable', message: 'ブラウザ内へ保存できませんでした。入力内容を残したまま、再試行してください。' }
}

function isCurrentGeneration(metadata: DemoMetadata, generationId: string): boolean {
  return metadata.lifecycleState === 'active' && metadata.generationId === generationId
}

function makeReadableCode(prefix: string, id: string): string {
  return `${prefix}-${id.replace(/-/g, '').slice(-12).toUpperCase()}`
}

function mapAvailabilityFailure(reason: Exclude<ReturnType<typeof evaluateAvailability>, { available: true }>['reason']):
  'capacityFull' | 'closed' | 'zeroLimit' | 'invalidSetting' | 'dateUnavailable' {
  if (reason === 'full') return 'capacityFull'
  if (reason === 'closed') return 'closed'
  if (reason === 'zeroLimit') return 'zeroLimit'
  if (reason === 'invalidSetting') return 'invalidSetting'
  return 'dateUnavailable'
}

async function ignoreAbort(done: Promise<void>): Promise<void> {
  try {
    await done
  } catch {
    // Expected when a validation or conflict result deliberately aborts the transaction.
  }
}

async function abortResult(
  transaction: IDBTransaction,
  done: Promise<void>,
  kind: 'capacityFull' | 'closed' | 'zeroLimit' | 'invalidSetting' | 'dateUnavailable' | 'versionConflict' | 'staleGeneration' | 'invalidTransition' | 'notFound',
): Promise<SaveResult> {
  transaction.abort()
  await ignoreAbort(done)
  return { kind }
}

async function abortValidation(transaction: IDBTransaction, done: Promise<void>, errors: ReturnType<typeof validateReservationInput>): Promise<SaveResult> {
  transaction.abort()
  await ignoreAbort(done)
  return { kind: 'validationError', errors }
}

function makeIdempotency(generationId: string, idempotencyKey: string, requestFingerprint: string, operation: string, resultPayload: OperationResultPayload, createdAt: string, targetEntityId?: string): IdempotencyRecord {
  return { generationId, idempotencyKey, requestFingerprint, operation, targetEntityId, resultKind: 'success', resultPayload, createdAt }
}

function reservationAuditValue(reservation: Reservation): Record<string, unknown> {
  return { requestedDate: reservation.requestedDate, categoryId: reservation.categoryId, companyName: reservation.companyName, contactName: reservation.contactName, phoneDisplay: reservation.phoneDisplay, address: reservation.address, contactNotes: reservation.contactNotes, categoryAnswers: reservation.categoryAnswers, status: reservation.status }
}
