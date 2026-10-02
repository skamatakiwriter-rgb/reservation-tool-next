import { evaluateAvailability } from '../availability'
import { categoryRequiresDispatch } from '../categories'
import { todayInJapan } from '../dateRules'
import { timeRangesOverlap } from '../dispatchRules'
import { snapshotForDispatch, type CollectionOutcome, type DispatchAssignment, type Driver, type InternalNote, type Vehicle } from '../dispatchTypes'
import { validateCollectionOutcome, validateDispatchCancelReason, validateDispatchPlan, validateInternalNote, validateVehicleHoldReason, type DispatchPlanInput } from '../dispatchValidation'
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
  ValidationError,
} from '../types'
import { normalizePhoneNumber, validateReservationInput } from '../validation'
import { fingerprint } from './fingerprint'
import { openReservationDatabase, requestResult, transactionDone } from './idb'
import { createDriverSeed, createSeedData, createVehicleSeed } from './seed'
import { allStoreNames, SCHEMA_VERSION, SEED_VERSION, storeNames } from './schema'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export type DemoSnapshot = {
  metadata: DemoMetadata | undefined
  reservations: Reservation[]
  settings: CategorySetting[]
  closures: Closure[]
  auditLogs: AuditLog[]
  vehicles: Vehicle[]
  drivers: Driver[]
  dispatchAssignments: DispatchAssignment[]
  internalNotes: InternalNote[]
}

export type InitializationResult = {
  kind: 'initialized' | 'retained'
  metadata: DemoMetadata
}

export type SaveResult =
  | { kind: 'success' | 'duplicateSuccess'; payload: OperationResultPayload }
  | { kind: 'validationError'; errors: ValidationError[] }
  | { kind: 'capacityFull' | 'closed' | 'zeroLimit' | 'invalidSetting' | 'dateUnavailable' }
  | { kind: 'versionConflict' | 'staleGeneration' | 'idempotencyConflict' | 'invalidTransition' | 'notFound' }
  | { kind: 'activeDispatchExists' | 'reservationNotDispatchable' | 'vehicleUnavailable' | 'vehicleOnHold' | 'driverUnavailable' | 'dispatchVersionConflict' | 'invalidDispatchTransition' | 'reviewRequired' | 'invalidOutcome' | 'vehicleHoldConflict' | 'vehicleVersionConflict' }
  | { kind: 'vehicleScheduleConflict' | 'driverScheduleConflict'; conflictingDispatchId: string }
  | { kind: 'driverHasActiveDispatches' }
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

export type CreateDispatchCommand = DispatchPlanInput & {
  generationId: string
  idempotencyKey: string
  actor: Actor
  reservationId: string
  expectedReservationVersion: number
}

export type UpdateDispatchCommand = CreateDispatchCommand & {
  dispatchId: string
  expectedDispatchVersion: number
}

export type CancelDispatchCommand = {
  generationId: string
  idempotencyKey: string
  actor: Actor
  reservationId: string
  expectedReservationVersion: number
  dispatchId: string
  expectedDispatchVersion: number
  cancelReason?: string
}

export type DispatchWorkCommand = {
  generationId: string
  idempotencyKey: string
  actor: Actor
  reservationId: string
  expectedReservationVersion: number
  dispatchId: string
  expectedDispatchVersion: number
}

export type CompleteDispatchCommand = DispatchWorkCommand & {
  outcome: CollectionOutcome
  actualCollectionSummary?: string
  outcomeNotes?: string
  holdRequest?: { expectedVehicleVersion: number; reason: string; consultationNote?: string }
}

export type StartVehicleLoadHoldCommand = {
  generationId: string
  idempotencyKey: string
  actor: Actor
  vehicleId: string
  expectedVehicleVersion: number
  reservationId: string
  dispatchId: string
  reason: string
  consultationNote?: string
}

export type ConfirmVehicleLoadHoldCommand = {
  generationId: string
  idempotencyKey: string
  actor: Actor
  vehicleId: string
  expectedVehicleVersion: number
  consultationNote: string
}

export type ReleaseVehicleLoadHoldCommand = {
  generationId: string
  idempotencyKey: string
  actor: Actor
  vehicleId: string
  expectedVehicleVersion: number
  reason: string
}

export type AcknowledgeDispatchReviewCommand = DispatchWorkCommand

export type AddInternalNoteCommand = {
  generationId: string
  idempotencyKey: string
  actor: Actor
  reservationId: string
  body: string
}

export type DriverInput = {
  fullName: string
  notes?: string
}

export type CreateDriverCommand = {
  generationId: string
  idempotencyKey: string
  actor: Actor
  input: DriverInput
}

export type UpdateDriverCommand = {
  generationId: string
  idempotencyKey: string
  actor: Actor
  driverId: string
  expectedVersion: number
  input: DriverInput
}

export type SetDriverActiveCommand = {
  generationId: string
  idempotencyKey: string
  actor: Actor
  driverId: string
  expectedVersion: number
  isActive: boolean
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
    if (!this.database) {
      const database = await openReservationDatabase(this.databaseName)
      database.onversionchange = () => {
        database.close()
        if (this.database === database) this.database = undefined
      }
      this.database = database
    }
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

    if (current?.lifecycleState === 'active' && !expired) {
      if (current.schemaVersion !== 1 && current.schemaVersion !== SCHEMA_VERSION) {
        transaction.abort()
        await ignoreAbort(done)
        throw new Error(`未対応のデータ形式です: ${current.schemaVersion}`)
      }
      if (current.schemaVersion === 1) {
        const vehicleStore = transaction.objectStore(storeNames.vehicles)
        const driverStore = transaction.objectStore(storeNames.drivers)
        if (await requestResult(vehicleStore.count()) === 0) {
          createVehicleSeed().forEach((vehicle) => vehicleStore.add(vehicle))
        }
        if (await requestResult(driverStore.count()) === 0) {
          createDriverSeed().forEach((driver) => driverStore.add(driver))
        }
        transaction.objectStore(storeNames.auditLogs).add({
          auditId: this.createId(),
          entityType: 'demo',
          entityId: 'demo',
          action: 'schemaMigrated',
          before: { schemaVersion: 1 },
          after: { schemaVersion: SCHEMA_VERSION },
          actor: 'demo-system',
          occurredAt: now,
        } satisfies AuditLog)
      }
      const updated = { ...current, schemaVersion: SCHEMA_VERSION, seedVersion: SEED_VERSION, lastUsedAt: now, updatedAt: now }
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
        after: { reservationId, reservationCode: reservation.reservationCode, requestedDate: reservation.requestedDate, status },
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
    if (command.nextStatus === 'completed' && categoryRequiresDispatch(reservation.categoryId)) {
      return abortSave(transaction, done, { kind: 'invalidTransition' })
    }
    const assignmentStore = transaction.objectStore(storeNames.dispatchAssignments)
    const assignments = command.nextStatus === 'cancelled'
      ? await requestResult(assignmentStore.index('byReservationId').getAll(reservation.reservationId)) as DispatchAssignment[]
      : []
    const activeAssignments = assignments.filter(isActiveDispatch)
    if (activeAssignments.length > 1 || activeAssignments.some((item) => item.status === 'inProgress')) {
      return abortSave(transaction, done, { kind: 'invalidTransition' })
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
      dispatchId: activeAssignments[0]?.dispatchId,
      dispatchVersion: activeAssignments[0] ? activeAssignments[0].version + 1 : undefined,
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
    if (command.nextStatus === 'cancelled' && activeAssignments.length === 1) {
      const currentAssignment = activeAssignments[0]
      const cancelledAssignment: DispatchAssignment = {
        ...currentAssignment,
        status: 'cancelled',
        cancelledAt: now,
        cancelledBy: command.actor,
        cancelReason: command.cancelReason?.trim() || undefined,
        updatedAt: now,
        updatedBy: command.actor,
        version: currentAssignment.version + 1,
      }
      assignmentStore.put(cancelledAssignment)
      transaction.objectStore(storeNames.auditLogs).add({
        auditId: this.createId(), entityType: 'dispatch', entityId: cancelledAssignment.dispatchId, action: 'dispatchCancelled',
        before: dispatchAuditValue(currentAssignment), after: dispatchAuditValue(cancelledAssignment), actor: command.actor, occurredAt: now,
      } satisfies AuditLog)
    }
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
    if (current.categoryId !== command.input.categoryId) return abortResult(transaction, done, 'invalidTransition')

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
    const assignmentStore = transaction.objectStore(storeNames.dispatchAssignments)
    const assignments = await requestResult(assignmentStore.index('byReservationId').getAll(current.reservationId)) as DispatchAssignment[]
    const activeAssignments = assignments.filter(isActiveDispatch)
    if (activeAssignments.length > 1) return abortResult(transaction, done, 'invalidTransition')
    const importantChanged = fingerprint(snapshotForDispatch(current)) !== fingerprint(snapshotForDispatch(updated))
    store.put(updated)
    transaction.objectStore(storeNames.auditLogs).add({ auditId: this.createId(), entityType: 'reservation', entityId: updated.reservationId, action: 'updated', before: reservationAuditValue(current), after: reservationAuditValue(updated), actor: command.actor, occurredAt: now } satisfies AuditLog)
    if (importantChanged && activeAssignments.length === 1) {
      const assignment = activeAssignments[0]
      assignmentStore.put({ ...assignment, needsReview: true, updatedAt: now, updatedBy: command.actor, version: assignment.version + 1 } satisfies DispatchAssignment)
      transaction.objectStore(storeNames.auditLogs).add({
        auditId: this.createId(), entityType: 'dispatch', entityId: assignment.dispatchId, action: 'dispatchReviewRequired',
        before: { needsReview: assignment.needsReview, reservationVersion: current.version },
        after: { needsReview: true, reservationVersion: updated.version }, actor: command.actor, occurredAt: now,
      } satisfies AuditLog)
    }
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

  async createDispatch(command: CreateDispatchCommand): Promise<SaveResult> {
    return this.executeSave(() => this.createDispatchUnsafe(command))
  }

  private async createDispatchUnsafe(command: CreateDispatchCommand): Promise<SaveResult> {
    const database = await this.getDatabase()
    const requestFingerprint = fingerprint({ operation: 'createDispatch', ...command })
    const transaction = database.transaction(allStoreNames, 'readwrite')
    const done = transactionDone(transaction)
    const metadata = await this.getMetadata(transaction)
    if (!isCurrentGeneration(metadata, command.generationId)) return abortSave(transaction, done, { kind: 'staleGeneration' })
    const replay = await this.replayResult(transaction, command.generationId, command.idempotencyKey, requestFingerprint)
    if (replay) return abortSave(transaction, done, replay)

    const reservation = await requestResult(transaction.objectStore(storeNames.reservations).get(command.reservationId)) as Reservation | undefined
    if (!reservation) return abortSave(transaction, done, { kind: 'notFound' })
    if (reservation.version !== command.expectedReservationVersion) return abortSave(transaction, done, { kind: 'versionConflict' })
    if (reservation.status !== 'confirmed' || !categoryRequiresDispatch(reservation.categoryId)) {
      return abortSave(transaction, done, { kind: 'reservationNotDispatchable' })
    }
    const assignmentStore = transaction.objectStore(storeNames.dispatchAssignments)
    const previous = await requestResult(assignmentStore.index('byReservationId').getAll(command.reservationId)) as DispatchAssignment[]
    if (previous.some((item) => item.status === 'assigned' || item.status === 'inProgress')) {
      return abortSave(transaction, done, { kind: 'activeDispatchExists' })
    }
    if (!previous.some((item) => item.status === 'completed') && command.plannedDate !== reservation.requestedDate) {
      return abortSave(transaction, done, { kind: 'validationError', errors: [{ field: 'plannedDate', code: 'initialDateMismatch', message: '初回の配車予定日は予約日と一致させてください。' }] })
    }
    const planError = await this.checkDispatchPlan(transaction, command)
    if (planError) return abortSave(transaction, done, planError)

    const now = this.now().toISOString()
    const dispatchId = this.createId()
    const attemptNumber = Math.max(0, ...previous.map((item) => item.attemptNumber)) + 1
    const snapshot = snapshotForDispatch(reservation)
    const assignment: DispatchAssignment = {
      dispatchId,
      reservationId: reservation.reservationId,
      attemptNumber,
      plannedDate: command.plannedDate,
      plannedStartTime: command.plannedStartTime,
      plannedEndTime: command.plannedEndTime,
      vehicleId: command.vehicleId,
      primaryDriverId: command.primaryDriverId,
      status: 'assigned',
      reservationVersionAtAssignment: reservation.version,
      reservationSnapshotAtAssignment: snapshot,
      reservationVersionAtLastReview: reservation.version,
      reservationSnapshotAtLastReview: structuredClone(snapshot),
      needsReview: false,
      driverInstructions: command.driverInstructions?.trim() || undefined,
      createdAt: now,
      createdBy: command.actor,
      updatedAt: now,
      updatedBy: command.actor,
      version: 1,
    }
    const payload: OperationResultPayload = { generationId: metadata.generationId, reservationId: reservation.reservationId, dispatchId, dispatchVersion: 1, attemptNumber }
    assignmentStore.add(assignment)
    transaction.objectStore(storeNames.auditLogs).add({
      auditId: this.createId(), entityType: 'dispatch', entityId: dispatchId, action: 'dispatchCreated',
      after: dispatchAuditValue(assignment), actor: command.actor, occurredAt: now,
    } satisfies AuditLog)
    transaction.objectStore(storeNames.idempotency).add(makeIdempotency(metadata.generationId, command.idempotencyKey, requestFingerprint, 'createDispatch', payload, now, dispatchId))
    transaction.objectStore(storeNames.metadata).put({ ...metadata, lastUsedAt: now, updatedAt: now })
    await done
    return { kind: 'success', payload }
  }

  async updateDispatch(command: UpdateDispatchCommand): Promise<SaveResult> {
    return this.executeSave(() => this.updateDispatchUnsafe(command))
  }

  private async updateDispatchUnsafe(command: UpdateDispatchCommand): Promise<SaveResult> {
    const database = await this.getDatabase()
    const requestFingerprint = fingerprint({ operation: 'updateDispatch', ...command })
    const transaction = database.transaction(allStoreNames, 'readwrite')
    const done = transactionDone(transaction)
    const metadata = await this.getMetadata(transaction)
    if (!isCurrentGeneration(metadata, command.generationId)) return abortSave(transaction, done, { kind: 'staleGeneration' })
    const replay = await this.replayResult(transaction, command.generationId, command.idempotencyKey, requestFingerprint)
    if (replay) return abortSave(transaction, done, replay)

    const reservation = await requestResult(transaction.objectStore(storeNames.reservations).get(command.reservationId)) as Reservation | undefined
    if (!reservation) return abortSave(transaction, done, { kind: 'notFound' })
    if (reservation.version !== command.expectedReservationVersion) return abortSave(transaction, done, { kind: 'versionConflict' })
    if (reservation.status !== 'confirmed' || !categoryRequiresDispatch(reservation.categoryId)) {
      return abortSave(transaction, done, { kind: 'reservationNotDispatchable' })
    }
    const assignmentStore = transaction.objectStore(storeNames.dispatchAssignments)
    const current = await requestResult(assignmentStore.get(command.dispatchId)) as DispatchAssignment | undefined
    if (!current || current.reservationId !== reservation.reservationId) return abortSave(transaction, done, { kind: 'notFound' })
    if (current.version !== command.expectedDispatchVersion) return abortSave(transaction, done, { kind: 'dispatchVersionConflict' })
    if (current.status !== 'assigned') return abortSave(transaction, done, { kind: 'invalidDispatchTransition' })
    const previous = await requestResult(assignmentStore.index('byReservationId').getAll(command.reservationId)) as DispatchAssignment[]
    if (previous.some((item) => item.dispatchId !== current.dispatchId && isActiveDispatch(item))) {
      return abortSave(transaction, done, { kind: 'activeDispatchExists' })
    }
    if (!previous.some((item) => item.status === 'completed') && command.plannedDate !== reservation.requestedDate) {
      return abortSave(transaction, done, { kind: 'validationError', errors: [{ field: 'plannedDate', code: 'initialDateMismatch', message: '初回の配車予定日は予約日と一致させてください。' }] })
    }
    const planError = await this.checkDispatchPlan(transaction, command, current.dispatchId)
    if (planError) return abortSave(transaction, done, planError)

    const now = this.now().toISOString()
    const updated: DispatchAssignment = {
      ...current,
      plannedDate: command.plannedDate,
      plannedStartTime: command.plannedStartTime,
      plannedEndTime: command.plannedEndTime,
      vehicleId: command.vehicleId,
      primaryDriverId: command.primaryDriverId,
      driverInstructions: command.driverInstructions?.trim() || undefined,
      updatedAt: now,
      updatedBy: command.actor,
      version: current.version + 1,
    }
    const payload: OperationResultPayload = { generationId: metadata.generationId, reservationId: reservation.reservationId, dispatchId: updated.dispatchId, dispatchVersion: updated.version, attemptNumber: updated.attemptNumber }
    assignmentStore.put(updated)
    transaction.objectStore(storeNames.auditLogs).add({
      auditId: this.createId(), entityType: 'dispatch', entityId: updated.dispatchId, action: 'dispatchUpdated',
      before: dispatchAuditValue(current), after: dispatchAuditValue(updated), actor: command.actor, occurredAt: now,
    } satisfies AuditLog)
    transaction.objectStore(storeNames.idempotency).add(makeIdempotency(metadata.generationId, command.idempotencyKey, requestFingerprint, 'updateDispatch', payload, now, updated.dispatchId))
    transaction.objectStore(storeNames.metadata).put({ ...metadata, lastUsedAt: now, updatedAt: now })
    await done
    return { kind: 'success', payload }
  }

  async cancelDispatch(command: CancelDispatchCommand): Promise<SaveResult> {
    return this.executeSave(() => this.cancelDispatchUnsafe(command))
  }

  private async cancelDispatchUnsafe(command: CancelDispatchCommand): Promise<SaveResult> {
    const database = await this.getDatabase()
    const requestFingerprint = fingerprint({ operation: 'cancelDispatch', ...command })
    const transaction = database.transaction(allStoreNames, 'readwrite')
    const done = transactionDone(transaction)
    const metadata = await this.getMetadata(transaction)
    if (!isCurrentGeneration(metadata, command.generationId)) return abortSave(transaction, done, { kind: 'staleGeneration' })
    const replay = await this.replayResult(transaction, command.generationId, command.idempotencyKey, requestFingerprint)
    if (replay) return abortSave(transaction, done, replay)
    const reasonErrors = validateDispatchCancelReason(command.cancelReason)
    if (reasonErrors.length > 0) return abortSave(transaction, done, { kind: 'validationError', errors: reasonErrors })

    const reservation = await requestResult(transaction.objectStore(storeNames.reservations).get(command.reservationId)) as Reservation | undefined
    if (!reservation) return abortSave(transaction, done, { kind: 'notFound' })
    if (reservation.version !== command.expectedReservationVersion) return abortSave(transaction, done, { kind: 'versionConflict' })
    if (reservation.status !== 'confirmed') return abortSave(transaction, done, { kind: 'reservationNotDispatchable' })
    const assignmentStore = transaction.objectStore(storeNames.dispatchAssignments)
    const current = await requestResult(assignmentStore.get(command.dispatchId)) as DispatchAssignment | undefined
    if (!current || current.reservationId !== reservation.reservationId) return abortSave(transaction, done, { kind: 'notFound' })
    if (current.version !== command.expectedDispatchVersion) return abortSave(transaction, done, { kind: 'dispatchVersionConflict' })
    if (current.status !== 'assigned') return abortSave(transaction, done, { kind: 'invalidDispatchTransition' })
    const sameReservationAssignments = await requestResult(assignmentStore.index('byReservationId').getAll(command.reservationId)) as DispatchAssignment[]
    if (sameReservationAssignments.some((item) => item.dispatchId !== current.dispatchId && isActiveDispatch(item))) {
      return abortSave(transaction, done, { kind: 'activeDispatchExists' })
    }

    const now = this.now().toISOString()
    const updated: DispatchAssignment = { ...current, status: 'cancelled', cancelledAt: now, cancelledBy: command.actor, cancelReason: command.cancelReason?.trim() || undefined, updatedAt: now, updatedBy: command.actor, version: current.version + 1 }
    const payload: OperationResultPayload = { generationId: metadata.generationId, reservationId: reservation.reservationId, dispatchId: updated.dispatchId, dispatchVersion: updated.version, attemptNumber: updated.attemptNumber }
    assignmentStore.put(updated)
    transaction.objectStore(storeNames.auditLogs).add({
      auditId: this.createId(), entityType: 'dispatch', entityId: updated.dispatchId, action: 'dispatchCancelled',
      before: dispatchAuditValue(current), after: dispatchAuditValue(updated), actor: command.actor, occurredAt: now,
    } satisfies AuditLog)
    transaction.objectStore(storeNames.idempotency).add(makeIdempotency(metadata.generationId, command.idempotencyKey, requestFingerprint, 'cancelDispatch', payload, now, updated.dispatchId))
    transaction.objectStore(storeNames.metadata).put({ ...metadata, lastUsedAt: now, updatedAt: now })
    await done
    return { kind: 'success', payload }
  }

  async startDispatch(command: DispatchWorkCommand): Promise<SaveResult> {
    return this.executeSave(() => this.startDispatchUnsafe(command))
  }

  private async startDispatchUnsafe(command: DispatchWorkCommand): Promise<SaveResult> {
    const database = await this.getDatabase()
    const requestFingerprint = fingerprint({ operation: 'startDispatch', ...command })
    const transaction = database.transaction(allStoreNames, 'readwrite')
    const done = transactionDone(transaction)
    const metadata = await this.getMetadata(transaction)
    if (!isCurrentGeneration(metadata, command.generationId)) return abortSave(transaction, done, { kind: 'staleGeneration' })
    const replay = await this.replayResult(transaction, command.generationId, command.idempotencyKey, requestFingerprint)
    if (replay) return abortSave(transaction, done, replay)
    const reservation = await requestResult(transaction.objectStore(storeNames.reservations).get(command.reservationId)) as Reservation | undefined
    if (!reservation) return abortSave(transaction, done, { kind: 'notFound' })
    if (reservation.version !== command.expectedReservationVersion) return abortSave(transaction, done, { kind: 'versionConflict' })
    if (reservation.status !== 'confirmed' || !categoryRequiresDispatch(reservation.categoryId)) {
      return abortSave(transaction, done, { kind: 'reservationNotDispatchable' })
    }
    const assignmentStore = transaction.objectStore(storeNames.dispatchAssignments)
    const current = await requestResult(assignmentStore.get(command.dispatchId)) as DispatchAssignment | undefined
    if (!current || current.reservationId !== reservation.reservationId) return abortSave(transaction, done, { kind: 'notFound' })
    if (current.version !== command.expectedDispatchVersion) return abortSave(transaction, done, { kind: 'dispatchVersionConflict' })
    if (current.status !== 'assigned') return abortSave(transaction, done, { kind: 'invalidDispatchTransition' })
    if (current.needsReview) return abortSave(transaction, done, { kind: 'reviewRequired' })
    const related = await requestResult(assignmentStore.index('byReservationId').getAll(reservation.reservationId)) as DispatchAssignment[]
    if (related.some((item) => item.dispatchId !== current.dispatchId && isActiveDispatch(item))) {
      return abortSave(transaction, done, { kind: 'activeDispatchExists' })
    }
    const vehicle = await requestResult(transaction.objectStore(storeNames.vehicles).get(current.vehicleId)) as Vehicle | undefined
    if (!vehicle) return abortSave(transaction, done, { kind: 'vehicleUnavailable' })
    if (vehicle.loadHold) return abortSave(transaction, done, { kind: 'vehicleOnHold' })

    const now = this.now().toISOString()
    const updated: DispatchAssignment = { ...current, status: 'inProgress', startedAt: now, startedBy: command.actor, updatedAt: now, updatedBy: command.actor, version: current.version + 1 }
    const payload: OperationResultPayload = { generationId: metadata.generationId, reservationId: reservation.reservationId, dispatchId: updated.dispatchId, dispatchVersion: updated.version, attemptNumber: updated.attemptNumber }
    assignmentStore.put(updated)
    transaction.objectStore(storeNames.auditLogs).add({ auditId: this.createId(), entityType: 'dispatch', entityId: updated.dispatchId, action: 'dispatchStarted', before: { status: current.status }, after: { status: updated.status }, actor: command.actor, occurredAt: now } satisfies AuditLog)
    transaction.objectStore(storeNames.idempotency).add(makeIdempotency(metadata.generationId, command.idempotencyKey, requestFingerprint, 'startDispatch', payload, now, updated.dispatchId))
    transaction.objectStore(storeNames.metadata).put({ ...metadata, lastUsedAt: now, updatedAt: now })
    await done
    return { kind: 'success', payload }
  }

  async completeDispatch(command: CompleteDispatchCommand): Promise<SaveResult> {
    return this.executeSave(() => this.completeDispatchUnsafe(command))
  }

  private async completeDispatchUnsafe(command: CompleteDispatchCommand): Promise<SaveResult> {
    const database = await this.getDatabase()
    const requestFingerprint = fingerprint({ operation: 'completeDispatch', ...command })
    const transaction = database.transaction(allStoreNames, 'readwrite')
    const done = transactionDone(transaction)
    const metadata = await this.getMetadata(transaction)
    if (!isCurrentGeneration(metadata, command.generationId)) return abortSave(transaction, done, { kind: 'staleGeneration' })
    const replay = await this.replayResult(transaction, command.generationId, command.idempotencyKey, requestFingerprint)
    if (replay) return abortSave(transaction, done, replay)
    const reservationStore = transaction.objectStore(storeNames.reservations)
    const reservation = await requestResult(reservationStore.get(command.reservationId)) as Reservation | undefined
    if (!reservation) return abortSave(transaction, done, { kind: 'notFound' })
    if (reservation.version !== command.expectedReservationVersion) return abortSave(transaction, done, { kind: 'versionConflict' })
    if (reservation.status !== 'confirmed' || !categoryRequiresDispatch(reservation.categoryId)) {
      return abortSave(transaction, done, { kind: 'reservationNotDispatchable' })
    }
    const assignmentStore = transaction.objectStore(storeNames.dispatchAssignments)
    const current = await requestResult(assignmentStore.get(command.dispatchId)) as DispatchAssignment | undefined
    if (!current || current.reservationId !== reservation.reservationId) return abortSave(transaction, done, { kind: 'notFound' })
    if (current.version !== command.expectedDispatchVersion) return abortSave(transaction, done, { kind: 'dispatchVersionConflict' })
    if (current.status !== 'assigned' && current.status !== 'inProgress') return abortSave(transaction, done, { kind: 'invalidDispatchTransition' })
    if (current.status === 'assigned' && current.needsReview) return abortSave(transaction, done, { kind: 'reviewRequired' })
    const related = await requestResult(assignmentStore.index('byReservationId').getAll(reservation.reservationId)) as DispatchAssignment[]
    if (related.some((item) => item.dispatchId !== current.dispatchId && isActiveDispatch(item))) {
      return abortSave(transaction, done, { kind: 'activeDispatchExists' })
    }
    const outcomeErrors = validateCollectionOutcome(command.outcome, command.actualCollectionSummary, command.outcomeNotes)
    if (outcomeErrors.some((error) => error.field === 'outcome')) return abortSave(transaction, done, { kind: 'invalidOutcome' })
    if (outcomeErrors.length > 0) return abortSave(transaction, done, { kind: 'validationError', errors: outcomeErrors })
    if (command.holdRequest && (command.actor !== 'demo-admin' || command.outcome === 'notCollected')) {
      return abortSave(transaction, done, { kind: 'invalidOutcome' })
    }
    if (command.holdRequest) {
      const holdErrors = validateVehicleHoldReason(command.holdRequest.reason, command.holdRequest.consultationNote)
      if (holdErrors.length > 0) return abortSave(transaction, done, { kind: 'validationError', errors: holdErrors })
    }
    const vehicleStore = transaction.objectStore(storeNames.vehicles)
    const vehicle = await requestResult(vehicleStore.get(current.vehicleId)) as Vehicle | undefined
    if (!vehicle) return abortSave(transaction, done, { kind: 'vehicleUnavailable' })
    if (vehicle.loadHold) return abortSave(transaction, done, { kind: 'vehicleOnHold' })
    if (command.holdRequest && vehicle.version !== command.holdRequest.expectedVehicleVersion) {
      return abortSave(transaction, done, { kind: 'vehicleVersionConflict' })
    }

    const now = this.now().toISOString()
    const updated: DispatchAssignment = {
      ...current,
      status: 'completed',
      completedAt: now,
      completedBy: command.actor,
      outcome: command.outcome,
      actualCollectionSummary: command.actualCollectionSummary?.trim() || undefined,
      outcomeNotes: command.outcomeNotes?.trim() || undefined,
      updatedAt: now,
      updatedBy: command.actor,
      version: current.version + 1,
    }
    const completedReservation: Reservation | undefined = command.outcome === 'allCollected'
      ? { ...reservation, status: 'completed', completedAt: now, completedBy: command.actor, updatedAt: now, version: reservation.version + 1 }
      : undefined
    const updatedVehicle: Vehicle | undefined = command.holdRequest
      ? { ...vehicle, loadHold: { status: 'decisionPending', reservationId: reservation.reservationId, dispatchId: current.dispatchId, reason: command.holdRequest.reason.trim(), consultationNote: command.holdRequest.consultationNote?.trim() ?? '', startedAt: now, startedBy: command.actor }, version: vehicle.version + 1 }
      : undefined
    const payload: OperationResultPayload = {
      generationId: metadata.generationId,
      reservationId: reservation.reservationId,
      version: completedReservation?.version ?? reservation.version,
      dispatchId: updated.dispatchId,
      dispatchVersion: updated.version,
      attemptNumber: updated.attemptNumber,
      vehicleId: updatedVehicle?.vehicleId,
      vehicleVersion: updatedVehicle?.version,
    }
    assignmentStore.put(updated)
    if (completedReservation) reservationStore.put(completedReservation)
    if (updatedVehicle) vehicleStore.put(updatedVehicle)
    const auditStore = transaction.objectStore(storeNames.auditLogs)
    auditStore.add({ auditId: this.createId(), entityType: 'dispatch', entityId: updated.dispatchId, action: 'dispatchCompleted', before: { status: current.status }, after: { status: updated.status, outcome: updated.outcome }, actor: command.actor, occurredAt: now } satisfies AuditLog)
    if (completedReservation) auditStore.add({ auditId: this.createId(), entityType: 'reservation', entityId: reservation.reservationId, action: 'completed', before: { status: reservation.status }, after: { status: 'completed' }, actor: command.actor, occurredAt: now } satisfies AuditLog)
    if (updatedVehicle) auditStore.add({ auditId: this.createId(), entityType: 'vehicle', entityId: vehicle.vehicleId, action: 'loadHoldStarted', after: { status: 'decisionPending', reservationId: reservation.reservationId, dispatchId: current.dispatchId }, actor: command.actor, occurredAt: now } satisfies AuditLog)
    transaction.objectStore(storeNames.idempotency).add(makeIdempotency(metadata.generationId, command.idempotencyKey, requestFingerprint, 'completeDispatch', payload, now, updated.dispatchId))
    transaction.objectStore(storeNames.metadata).put({ ...metadata, lastUsedAt: now, updatedAt: now })
    await done
    return { kind: 'success', payload }
  }

  async startVehicleLoadHold(command: StartVehicleLoadHoldCommand): Promise<SaveResult> {
    return this.executeSave(() => this.startVehicleLoadHoldUnsafe(command))
  }

  private async startVehicleLoadHoldUnsafe(command: StartVehicleLoadHoldCommand): Promise<SaveResult> {
    const database = await this.getDatabase()
    const requestFingerprint = fingerprint({ operation: 'startVehicleLoadHold', ...command })
    const transaction = database.transaction(allStoreNames, 'readwrite')
    const done = transactionDone(transaction)
    const metadata = await this.getMetadata(transaction)
    if (!isCurrentGeneration(metadata, command.generationId)) return abortSave(transaction, done, { kind: 'staleGeneration' })
    const replay = await this.replayResult(transaction, command.generationId, command.idempotencyKey, requestFingerprint)
    if (replay) return abortSave(transaction, done, replay)
    if (command.actor !== 'demo-admin') return abortSave(transaction, done, { kind: 'invalidTransition' })
    const errors = validateVehicleHoldReason(command.reason, command.consultationNote)
    if (errors.length > 0) return abortSave(transaction, done, { kind: 'validationError', errors })

    const assignment = await requestResult(transaction.objectStore(storeNames.dispatchAssignments).get(command.dispatchId)) as DispatchAssignment | undefined
    if (!assignment || assignment.reservationId !== command.reservationId || assignment.vehicleId !== command.vehicleId) {
      return abortSave(transaction, done, { kind: 'notFound' })
    }
    if (assignment.status !== 'completed' || (assignment.outcome !== 'allCollected' && assignment.outcome !== 'partiallyCollected')) {
      return abortSave(transaction, done, { kind: 'invalidDispatchTransition' })
    }
    const reservation = await requestResult(transaction.objectStore(storeNames.reservations).get(command.reservationId)) as Reservation | undefined
    if (!reservation) return abortSave(transaction, done, { kind: 'notFound' })
    const vehicleStore = transaction.objectStore(storeNames.vehicles)
    const vehicle = await requestResult(vehicleStore.get(command.vehicleId)) as Vehicle | undefined
    if (!vehicle) return abortSave(transaction, done, { kind: 'vehicleUnavailable' })
    if (vehicle.version !== command.expectedVehicleVersion) return abortSave(transaction, done, { kind: 'vehicleVersionConflict' })
    if (vehicle.loadHold) return abortSave(transaction, done, { kind: 'vehicleHoldConflict' })

    const now = this.now().toISOString()
    const updated: Vehicle = {
      ...vehicle,
      loadHold: { status: 'decisionPending', reservationId: command.reservationId, dispatchId: command.dispatchId, reason: command.reason.trim(), consultationNote: command.consultationNote?.trim() ?? '', startedAt: now, startedBy: command.actor },
      version: vehicle.version + 1,
    }
    const payload: OperationResultPayload = { generationId: metadata.generationId, reservationId: command.reservationId, dispatchId: command.dispatchId, vehicleId: vehicle.vehicleId, vehicleVersion: updated.version }
    vehicleStore.put(updated)
    transaction.objectStore(storeNames.auditLogs).add({ auditId: this.createId(), entityType: 'vehicle', entityId: vehicle.vehicleId, action: 'loadHoldStarted', after: { status: 'decisionPending', reservationId: command.reservationId, dispatchId: command.dispatchId }, actor: command.actor, occurredAt: now } satisfies AuditLog)
    transaction.objectStore(storeNames.idempotency).add(makeIdempotency(metadata.generationId, command.idempotencyKey, requestFingerprint, 'startVehicleLoadHold', payload, now, vehicle.vehicleId))
    transaction.objectStore(storeNames.metadata).put({ ...metadata, lastUsedAt: now, updatedAt: now })
    await done
    return { kind: 'success', payload }
  }

  async confirmVehicleLoadHold(command: ConfirmVehicleLoadHoldCommand): Promise<SaveResult> {
    return this.executeSave(() => this.confirmVehicleLoadHoldUnsafe(command))
  }

  private async confirmVehicleLoadHoldUnsafe(command: ConfirmVehicleLoadHoldCommand): Promise<SaveResult> {
    const database = await this.getDatabase()
    const requestFingerprint = fingerprint({ operation: 'confirmVehicleLoadHold', ...command })
    const transaction = database.transaction(allStoreNames, 'readwrite')
    const done = transactionDone(transaction)
    const metadata = await this.getMetadata(transaction)
    if (!isCurrentGeneration(metadata, command.generationId)) return abortSave(transaction, done, { kind: 'staleGeneration' })
    const replay = await this.replayResult(transaction, command.generationId, command.idempotencyKey, requestFingerprint)
    if (replay) return abortSave(transaction, done, replay)
    if (command.actor !== 'demo-admin') return abortSave(transaction, done, { kind: 'invalidTransition' })
    if (!command.consultationNote.trim() || command.consultationNote.trim().length > 500) {
      return abortSave(transaction, done, { kind: 'validationError', errors: [{ field: 'consultationNote', code: 'invalidLength', message: '電話相談の判断内容を500文字以内で入力してください。' }] })
    }
    const vehicleStore = transaction.objectStore(storeNames.vehicles)
    const vehicle = await requestResult(vehicleStore.get(command.vehicleId)) as Vehicle | undefined
    if (!vehicle) return abortSave(transaction, done, { kind: 'vehicleUnavailable' })
    if (vehicle.version !== command.expectedVehicleVersion) return abortSave(transaction, done, { kind: 'vehicleVersionConflict' })
    if (vehicle.loadHold?.status !== 'decisionPending') return abortSave(transaction, done, { kind: 'vehicleHoldConflict' })

    const now = this.now().toISOString()
    const updated: Vehicle = { ...vehicle, loadHold: { ...vehicle.loadHold, status: 'storedOnVehicle', consultationNote: command.consultationNote.trim() }, version: vehicle.version + 1 }
    const payload: OperationResultPayload = { generationId: metadata.generationId, reservationId: updated.loadHold?.reservationId, dispatchId: updated.loadHold?.dispatchId, vehicleId: vehicle.vehicleId, vehicleVersion: updated.version }
    vehicleStore.put(updated)
    transaction.objectStore(storeNames.auditLogs).add({ auditId: this.createId(), entityType: 'vehicle', entityId: vehicle.vehicleId, action: 'loadHoldConfirmed', before: { status: 'decisionPending' }, after: { status: 'storedOnVehicle', reservationId: updated.loadHold?.reservationId }, actor: command.actor, occurredAt: now } satisfies AuditLog)
    transaction.objectStore(storeNames.idempotency).add(makeIdempotency(metadata.generationId, command.idempotencyKey, requestFingerprint, 'confirmVehicleLoadHold', payload, now, vehicle.vehicleId))
    transaction.objectStore(storeNames.metadata).put({ ...metadata, lastUsedAt: now, updatedAt: now })
    await done
    return { kind: 'success', payload }
  }

  async releaseVehicleLoadHold(command: ReleaseVehicleLoadHoldCommand): Promise<SaveResult> {
    return this.executeSave(() => this.releaseVehicleLoadHoldUnsafe(command))
  }

  private async releaseVehicleLoadHoldUnsafe(command: ReleaseVehicleLoadHoldCommand): Promise<SaveResult> {
    const database = await this.getDatabase()
    const requestFingerprint = fingerprint({ operation: 'releaseVehicleLoadHold', ...command })
    const transaction = database.transaction(allStoreNames, 'readwrite')
    const done = transactionDone(transaction)
    const metadata = await this.getMetadata(transaction)
    if (!isCurrentGeneration(metadata, command.generationId)) return abortSave(transaction, done, { kind: 'staleGeneration' })
    const replay = await this.replayResult(transaction, command.generationId, command.idempotencyKey, requestFingerprint)
    if (replay) return abortSave(transaction, done, replay)
    if (command.actor !== 'demo-admin') return abortSave(transaction, done, { kind: 'invalidTransition' })
    if (!command.reason.trim() || command.reason.trim().length > 500) {
      return abortSave(transaction, done, { kind: 'validationError', errors: [{ field: 'releaseReason', code: 'invalidLength', message: '積載解消の理由を500文字以内で入力してください。' }] })
    }
    const vehicleStore = transaction.objectStore(storeNames.vehicles)
    const vehicle = await requestResult(vehicleStore.get(command.vehicleId)) as Vehicle | undefined
    if (!vehicle) return abortSave(transaction, done, { kind: 'vehicleUnavailable' })
    if (vehicle.version !== command.expectedVehicleVersion) return abortSave(transaction, done, { kind: 'vehicleVersionConflict' })
    if (!vehicle.loadHold) return abortSave(transaction, done, { kind: 'vehicleHoldConflict' })

    const now = this.now().toISOString()
    const updated: Vehicle = { ...vehicle, loadHold: undefined, version: vehicle.version + 1 }
    const payload: OperationResultPayload = { generationId: metadata.generationId, reservationId: vehicle.loadHold.reservationId, dispatchId: vehicle.loadHold.dispatchId, vehicleId: vehicle.vehicleId, vehicleVersion: updated.version }
    vehicleStore.put(updated)
    transaction.objectStore(storeNames.auditLogs).add({ auditId: this.createId(), entityType: 'vehicle', entityId: vehicle.vehicleId, action: 'loadHoldReleased', before: { status: vehicle.loadHold.status, reservationId: vehicle.loadHold.reservationId }, after: { status: 'released' }, actor: command.actor, occurredAt: now, note: command.reason.trim() } satisfies AuditLog)
    transaction.objectStore(storeNames.idempotency).add(makeIdempotency(metadata.generationId, command.idempotencyKey, requestFingerprint, 'releaseVehicleLoadHold', payload, now, vehicle.vehicleId))
    transaction.objectStore(storeNames.metadata).put({ ...metadata, lastUsedAt: now, updatedAt: now })
    await done
    return { kind: 'success', payload }
  }

  async acknowledgeDispatchReview(command: AcknowledgeDispatchReviewCommand): Promise<SaveResult> {
    return this.executeSave(() => this.acknowledgeDispatchReviewUnsafe(command))
  }

  private async acknowledgeDispatchReviewUnsafe(command: AcknowledgeDispatchReviewCommand): Promise<SaveResult> {
    const database = await this.getDatabase()
    const requestFingerprint = fingerprint({ operation: 'acknowledgeDispatchReview', ...command })
    const transaction = database.transaction(allStoreNames, 'readwrite')
    const done = transactionDone(transaction)
    const metadata = await this.getMetadata(transaction)
    if (!isCurrentGeneration(metadata, command.generationId)) return abortSave(transaction, done, { kind: 'staleGeneration' })
    const replay = await this.replayResult(transaction, command.generationId, command.idempotencyKey, requestFingerprint)
    if (replay) return abortSave(transaction, done, replay)
    if (command.actor !== 'demo-admin') return abortSave(transaction, done, { kind: 'invalidTransition' })

    const reservation = await requestResult(transaction.objectStore(storeNames.reservations).get(command.reservationId)) as Reservation | undefined
    if (!reservation) return abortSave(transaction, done, { kind: 'notFound' })
    if (reservation.version !== command.expectedReservationVersion) return abortSave(transaction, done, { kind: 'versionConflict' })
    if (reservation.status !== 'confirmed' || !categoryRequiresDispatch(reservation.categoryId)) {
      return abortSave(transaction, done, { kind: 'reservationNotDispatchable' })
    }
    const assignmentStore = transaction.objectStore(storeNames.dispatchAssignments)
    const current = await requestResult(assignmentStore.get(command.dispatchId)) as DispatchAssignment | undefined
    if (!current || current.reservationId !== reservation.reservationId) return abortSave(transaction, done, { kind: 'notFound' })
    if (current.version !== command.expectedDispatchVersion) return abortSave(transaction, done, { kind: 'dispatchVersionConflict' })
    if (!isActiveDispatch(current) || !current.needsReview) return abortSave(transaction, done, { kind: 'invalidDispatchTransition' })
    if (current.status === 'assigned' && current.plannedDate !== reservation.requestedDate) {
      return abortSave(transaction, done, { kind: 'invalidDispatchTransition' })
    }
    const related = await requestResult(assignmentStore.index('byReservationId').getAll(reservation.reservationId)) as DispatchAssignment[]
    if (related.some((item) => item.dispatchId !== current.dispatchId && isActiveDispatch(item))) {
      return abortSave(transaction, done, { kind: 'activeDispatchExists' })
    }

    const now = this.now().toISOString()
    const updated: DispatchAssignment = {
      ...current,
      reservationVersionAtLastReview: reservation.version,
      reservationSnapshotAtLastReview: snapshotForDispatch(reservation),
      needsReview: false,
      updatedAt: now,
      updatedBy: command.actor,
      version: current.version + 1,
    }
    const payload: OperationResultPayload = { generationId: metadata.generationId, reservationId: reservation.reservationId, version: reservation.version, dispatchId: updated.dispatchId, dispatchVersion: updated.version, attemptNumber: updated.attemptNumber }
    assignmentStore.put(updated)
    transaction.objectStore(storeNames.auditLogs).add({
      auditId: this.createId(), entityType: 'dispatch', entityId: updated.dispatchId, action: 'dispatchReviewAcknowledged',
      before: { needsReview: true, reservationVersionAtLastReview: current.reservationVersionAtLastReview },
      after: { needsReview: false, reservationVersionAtLastReview: reservation.version }, actor: command.actor, occurredAt: now,
    } satisfies AuditLog)
    transaction.objectStore(storeNames.idempotency).add(makeIdempotency(metadata.generationId, command.idempotencyKey, requestFingerprint, 'acknowledgeDispatchReview', payload, now, updated.dispatchId))
    transaction.objectStore(storeNames.metadata).put({ ...metadata, lastUsedAt: now, updatedAt: now })
    await done
    return { kind: 'success', payload }
  }

  async addInternalNote(command: AddInternalNoteCommand): Promise<SaveResult> {
    return this.executeSave(() => this.addInternalNoteUnsafe(command))
  }

  private async addInternalNoteUnsafe(command: AddInternalNoteCommand): Promise<SaveResult> {
    const database = await this.getDatabase()
    const requestFingerprint = fingerprint({ operation: 'addInternalNote', ...command })
    const transaction = database.transaction(allStoreNames, 'readwrite')
    const done = transactionDone(transaction)
    const metadata = await this.getMetadata(transaction)
    if (!isCurrentGeneration(metadata, command.generationId)) return abortSave(transaction, done, { kind: 'staleGeneration' })
    const replay = await this.replayResult(transaction, command.generationId, command.idempotencyKey, requestFingerprint)
    if (replay) return abortSave(transaction, done, replay)
    if (command.actor !== 'demo-admin') return abortSave(transaction, done, { kind: 'invalidTransition' })
    const errors = validateInternalNote(command.body)
    if (errors.length > 0) return abortSave(transaction, done, { kind: 'validationError', errors })
    const reservation = await requestResult(transaction.objectStore(storeNames.reservations).get(command.reservationId)) as Reservation | undefined
    if (!reservation) return abortSave(transaction, done, { kind: 'notFound' })

    const now = this.now().toISOString()
    const note: InternalNote = { noteId: this.createId(), reservationId: reservation.reservationId, body: command.body.trim(), createdAt: now, createdBy: command.actor }
    const payload: OperationResultPayload = { generationId: metadata.generationId, reservationId: reservation.reservationId, version: reservation.version, noteId: note.noteId }
    transaction.objectStore(storeNames.internalNotes).add(note)
    transaction.objectStore(storeNames.auditLogs).add({ auditId: this.createId(), entityType: 'internalNote', entityId: note.noteId, action: 'internalNoteAdded', after: { reservationId: reservation.reservationId }, actor: command.actor, occurredAt: now } satisfies AuditLog)
    transaction.objectStore(storeNames.idempotency).add(makeIdempotency(metadata.generationId, command.idempotencyKey, requestFingerprint, 'addInternalNote', payload, now, note.noteId))
    transaction.objectStore(storeNames.metadata).put({ ...metadata, lastUsedAt: now, updatedAt: now })
    await done
    return { kind: 'success', payload }
  }

  async createDriver(command: CreateDriverCommand): Promise<SaveResult> {
    return this.executeSave(() => this.createDriverUnsafe(command))
  }

  private async createDriverUnsafe(command: CreateDriverCommand): Promise<SaveResult> {
    const database = await this.getDatabase()
    const input = normalizeDriverInput(command.input)
    const requestFingerprint = fingerprint({ operation: 'createDriver', input })
    const transaction = database.transaction(allStoreNames, 'readwrite')
    const done = transactionDone(transaction)
    const metadata = await this.getMetadata(transaction)
    if (!isCurrentGeneration(metadata, command.generationId)) return abortSave(transaction, done, { kind: 'staleGeneration' })
    const replay = await this.replayResult(transaction, metadata.generationId, command.idempotencyKey, requestFingerprint)
    if (replay) return abortSave(transaction, done, replay)
    const errors = validateDriverInput(input)
    if (errors.length > 0) return abortValidation(transaction, done, errors)
    const drivers = await requestResult(transaction.objectStore(storeNames.drivers).getAll()) as Driver[]
    const driverCode = nextDriverCode(drivers)

    const now = this.now().toISOString()
    const driverId = this.createId()
    const driver: Driver = {
      driverId,
      driverCode,
      ...input,
      isActive: true,
      updatedAt: now,
      updatedBy: command.actor,
      version: 1,
    }
    const payload: OperationResultPayload = { generationId: metadata.generationId, driverId, driverVersion: 1 }
    transaction.objectStore(storeNames.drivers).add(driver)
    transaction.objectStore(storeNames.auditLogs).add({ auditId: this.createId(), entityType: 'driver', entityId: driverId, action: 'created', after: driverAuditValue(driver), actor: command.actor, occurredAt: now } satisfies AuditLog)
    transaction.objectStore(storeNames.idempotency).add(makeIdempotency(metadata.generationId, command.idempotencyKey, requestFingerprint, 'createDriver', payload, now, driverId))
    transaction.objectStore(storeNames.metadata).put({ ...metadata, lastUsedAt: now, updatedAt: now })
    await done
    return { kind: 'success', payload }
  }

  async updateDriver(command: UpdateDriverCommand): Promise<SaveResult> {
    return this.executeSave(() => this.updateDriverUnsafe(command))
  }

  private async updateDriverUnsafe(command: UpdateDriverCommand): Promise<SaveResult> {
    const database = await this.getDatabase()
    const input = normalizeDriverInput(command.input)
    const requestFingerprint = fingerprint({ operation: 'updateDriver', driverId: command.driverId, expectedVersion: command.expectedVersion, input })
    const transaction = database.transaction(allStoreNames, 'readwrite')
    const done = transactionDone(transaction)
    const metadata = await this.getMetadata(transaction)
    if (!isCurrentGeneration(metadata, command.generationId)) return abortSave(transaction, done, { kind: 'staleGeneration' })
    const replay = await this.replayResult(transaction, metadata.generationId, command.idempotencyKey, requestFingerprint)
    if (replay) return abortSave(transaction, done, replay)
    const store = transaction.objectStore(storeNames.drivers)
    const current = await requestResult(store.get(command.driverId)) as Driver | undefined
    if (!current) return abortSave(transaction, done, { kind: 'notFound' })
    if (current.version !== command.expectedVersion) return abortSave(transaction, done, { kind: 'versionConflict' })
    const errors = validateDriverInput(input)
    if (errors.length > 0) return abortValidation(transaction, done, errors)

    const now = this.now().toISOString()
    const updated: Driver = { ...current, ...input, updatedAt: now, updatedBy: command.actor, version: current.version + 1 }
    const payload: OperationResultPayload = { generationId: metadata.generationId, driverId: updated.driverId, driverVersion: updated.version }
    store.put(updated)
    transaction.objectStore(storeNames.auditLogs).add({ auditId: this.createId(), entityType: 'driver', entityId: updated.driverId, action: 'updated', before: driverAuditValue(current), after: driverAuditValue(updated), actor: command.actor, occurredAt: now } satisfies AuditLog)
    transaction.objectStore(storeNames.idempotency).add(makeIdempotency(metadata.generationId, command.idempotencyKey, requestFingerprint, 'updateDriver', payload, now, updated.driverId))
    transaction.objectStore(storeNames.metadata).put({ ...metadata, lastUsedAt: now, updatedAt: now })
    await done
    return { kind: 'success', payload }
  }

  async setDriverActive(command: SetDriverActiveCommand): Promise<SaveResult> {
    return this.executeSave(() => this.setDriverActiveUnsafe(command))
  }

  private async setDriverActiveUnsafe(command: SetDriverActiveCommand): Promise<SaveResult> {
    const database = await this.getDatabase()
    const requestFingerprint = fingerprint({ operation: 'setDriverActive', ...command })
    const transaction = database.transaction(allStoreNames, 'readwrite')
    const done = transactionDone(transaction)
    const metadata = await this.getMetadata(transaction)
    if (!isCurrentGeneration(metadata, command.generationId)) return abortSave(transaction, done, { kind: 'staleGeneration' })
    const replay = await this.replayResult(transaction, metadata.generationId, command.idempotencyKey, requestFingerprint)
    if (replay) return abortSave(transaction, done, replay)
    const store = transaction.objectStore(storeNames.drivers)
    const current = await requestResult(store.get(command.driverId)) as Driver | undefined
    if (!current) return abortSave(transaction, done, { kind: 'notFound' })
    if (current.version !== command.expectedVersion) return abortSave(transaction, done, { kind: 'versionConflict' })
    if (current.isActive === command.isActive) {
      const payload: OperationResultPayload = { generationId: metadata.generationId, driverId: current.driverId, driverVersion: current.version }
      transaction.abort()
      await ignoreAbort(done)
      return { kind: 'success', payload }
    }
    if (!command.isActive) {
      const assignments = await requestResult(transaction.objectStore(storeNames.dispatchAssignments).getAll()) as DispatchAssignment[]
      if (assignments.some((assignment) => assignment.primaryDriverId === current.driverId && isActiveDispatch(assignment))) {
        return abortSave(transaction, done, { kind: 'driverHasActiveDispatches' })
      }
    }

    const now = this.now().toISOString()
    const updated: Driver = { ...current, isActive: command.isActive, updatedAt: now, updatedBy: command.actor, version: current.version + 1 }
    const payload: OperationResultPayload = { generationId: metadata.generationId, driverId: updated.driverId, driverVersion: updated.version }
    store.put(updated)
    transaction.objectStore(storeNames.auditLogs).add({ auditId: this.createId(), entityType: 'driver', entityId: updated.driverId, action: command.isActive ? 'activated' : 'deactivated', before: driverAuditValue(current), after: driverAuditValue(updated), actor: command.actor, occurredAt: now } satisfies AuditLog)
    transaction.objectStore(storeNames.idempotency).add(makeIdempotency(metadata.generationId, command.idempotencyKey, requestFingerprint, 'setDriverActive', payload, now, updated.driverId))
    transaction.objectStore(storeNames.metadata).put({ ...metadata, lastUsedAt: now, updatedAt: now })
    await done
    return { kind: 'success', payload }
  }

  private async checkDispatchPlan(transaction: IDBTransaction, plan: DispatchPlanInput, excludeDispatchId?: string): Promise<SaveResult | undefined> {
    const errors = validateDispatchPlan(plan)
    if (errors.length > 0) return { kind: 'validationError', errors }
    const vehicle = await requestResult(transaction.objectStore(storeNames.vehicles).get(plan.vehicleId)) as Vehicle | undefined
    if (!vehicle?.isActive) return { kind: 'vehicleUnavailable' }
    if (vehicle.loadHold) return { kind: 'vehicleOnHold' }
    const driver = await requestResult(transaction.objectStore(storeNames.drivers).get(plan.primaryDriverId)) as Driver | undefined
    if (!driver?.isActive) return { kind: 'driverUnavailable' }
    const assignmentStore = transaction.objectStore(storeNames.dispatchAssignments)
    const vehicleSchedule = await requestResult(assignmentStore.index('byVehicleDate').getAll([plan.vehicleId, plan.plannedDate])) as DispatchAssignment[]
    const vehicleConflict = vehicleSchedule.find((item) => item.dispatchId !== excludeDispatchId && isActiveDispatch(item) && timeRangesOverlap(item, plan))
    if (vehicleConflict) return { kind: 'vehicleScheduleConflict', conflictingDispatchId: vehicleConflict.dispatchId }
    const driverSchedule = await requestResult(assignmentStore.index('byDriverDate').getAll([plan.primaryDriverId, plan.plannedDate])) as DispatchAssignment[]
    const driverConflict = driverSchedule.find((item) => item.dispatchId !== excludeDispatchId && isActiveDispatch(item) && timeRangesOverlap(item, plan))
    if (driverConflict) return { kind: 'driverScheduleConflict', conflictingDispatchId: driverConflict.dispatchId }
    return undefined
  }

  async findOperationResult(generationId: string, idempotencyKey: string): Promise<IdempotencyRecord | undefined> {
    const database = await this.getDatabase()
    const transaction = database.transaction(storeNames.idempotency, 'readonly')
    return await requestResult(transaction.objectStore(storeNames.idempotency).get([generationId, idempotencyKey])) as IdempotencyRecord | undefined
  }

  async snapshot(scope: 'admin' | 'public' | 'driver' = 'admin'): Promise<DemoSnapshot> {
    const database = await this.getDatabase()
    const transaction = database.transaction(allStoreNames, 'readonly')
    const [metadata, reservations, settings, closures, auditLogs, vehicles, drivers, dispatchAssignments, internalNotes] = await Promise.all([
      requestResult(transaction.objectStore(storeNames.metadata).get('demo')),
      requestResult(transaction.objectStore(storeNames.reservations).getAll()),
      requestResult(transaction.objectStore(storeNames.settings).getAll()),
      requestResult(transaction.objectStore(storeNames.closures).getAll()),
      scope === 'admin' ? requestResult(transaction.objectStore(storeNames.auditLogs).getAll()) : Promise.resolve([]),
      scope === 'public' ? Promise.resolve([]) : requestResult(transaction.objectStore(storeNames.vehicles).getAll()),
      scope === 'public' ? Promise.resolve([]) : requestResult(transaction.objectStore(storeNames.drivers).getAll()),
      scope === 'public' ? Promise.resolve([]) : requestResult(transaction.objectStore(storeNames.dispatchAssignments).getAll()),
      scope === 'admin' ? requestResult(transaction.objectStore(storeNames.internalNotes).getAll()) : Promise.resolve([]),
    ])
    return {
      metadata: metadata as DemoMetadata | undefined,
      reservations: reservations as Reservation[],
      settings: settings as CategorySetting[],
      closures: closures as Closure[],
      auditLogs: auditLogs as AuditLog[],
      vehicles: vehicles as Vehicle[],
      drivers: drivers as Driver[],
      dispatchAssignments: dispatchAssignments as DispatchAssignment[],
      internalNotes: internalNotes as InternalNote[],
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
    seed.vehicles.forEach((vehicle) => transaction.objectStore(storeNames.vehicles).add(vehicle))
    seed.drivers.forEach((driver) => transaction.objectStore(storeNames.drivers).add(driver))
    seed.dispatchAssignments.forEach((assignment) => transaction.objectStore(storeNames.dispatchAssignments).add(assignment))
    seed.internalNotes.forEach((note) => transaction.objectStore(storeNames.internalNotes).add(note))
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

async function abortSave(transaction: IDBTransaction, done: Promise<void>, result: SaveResult): Promise<SaveResult> {
  transaction.abort()
  await ignoreAbort(done)
  return result
}

function isActiveDispatch(assignment: DispatchAssignment): boolean {
  return assignment.status === 'assigned' || assignment.status === 'inProgress'
}

function dispatchAuditValue(assignment: DispatchAssignment): Record<string, unknown> {
  return {
    reservationId: assignment.reservationId,
    attemptNumber: assignment.attemptNumber,
    status: assignment.status,
    plannedDate: assignment.plannedDate,
    plannedStartTime: assignment.plannedStartTime,
    plannedEndTime: assignment.plannedEndTime,
    vehicleId: assignment.vehicleId,
    primaryDriverId: assignment.primaryDriverId,
    version: assignment.version,
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

function normalizeDriverInput(input: DriverInput): DriverInput {
  return {
    fullName: input.fullName.trim(),
    notes: input.notes?.trim() || undefined,
  }
}

function validateDriverInput(input: DriverInput): ValidationError[] {
  const errors: ValidationError[] = []
  if (!input.fullName) errors.push({ field: 'fullName', code: 'required', message: '氏名を入力してください。' })
  else if (input.fullName.length > 80) errors.push({ field: 'fullName', code: 'maxLength', message: '氏名は80文字以内で入力してください。' })
  if ((input.notes?.length ?? 0) > 500) errors.push({ field: 'notes', code: 'maxLength', message: '備考は500文字以内で入力してください。' })
  return errors
}

function nextDriverCode(drivers: Driver[]): string {
  const largestNumber = drivers.reduce((largest, driver) => {
    const suffix = driver.driverCode.match(/(\d+)$/)?.[1]
    return suffix ? Math.max(largest, Number(suffix)) : largest
  }, 0)
  return `DRV-${String(largestNumber + 1).padStart(4, '0')}`
}

function driverAuditValue(driver: Driver): Record<string, unknown> {
  return {
    driverCode: driver.driverCode,
    fullName: driver.fullName,
    notes: driver.notes,
    isActive: driver.isActive,
    version: driver.version,
  }
}
