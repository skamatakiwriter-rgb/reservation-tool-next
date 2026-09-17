export const categoryIds = ['keikoukan', 'kagu', 'binkan'] as const
export type CategoryId = (typeof categoryIds)[number]

export const reservationStatuses = ['received', 'confirmed', 'completed', 'cancelled'] as const
export type ReservationStatus = (typeof reservationStatuses)[number]

export type RegistrationChannel = 'public' | 'admin'

export type ReservationForCapacity = {
  reservationId: string
  requestedDate: string
  categoryId: CategoryId
  status: ReservationStatus
}

export type CategorySetting = {
  categoryId: CategoryId
  dailyLimit: unknown
  version?: number
  updatedAt?: string
  updatedBy?: string
}

export type ReservationInput = {
  categoryId: CategoryId
  requestedDate: string
  companyName: string
  contactName: string
  phone: string
  address?: string
  contactNotes?: string
  categoryAnswers: Record<string, unknown>
  demoNoticeAccepted?: boolean
}

export type ValidationError = {
  field: string
  code: string
  message: string
}

export type Actor = 'demo-user' | 'demo-admin' | 'demo-system'

export type Reservation = ReservationForCapacity & {
  reservationCode: string
  workGroupId: string
  workGroupCode: string
  companyName: string
  contactName: string
  phoneDisplay: string
  phoneNormalized: string
  address?: string
  contactNotes?: string
  categoryAnswers: Record<string, unknown>
  createdAt: string
  createdBy: Actor
  updatedAt: string
  version: number
  confirmedAt?: string
  confirmedBy?: Actor
  completedAt?: string
  completedBy?: Actor
  cancelledAt?: string
  cancelledBy?: Actor
  cancelReason?: string
  overrideType?: 'fullCapacity'
  sourceReservationId?: string
}

export type Closure = {
  closureId: string
  date: string
  categoryId: CategoryId
  isClosed: boolean
  version: number
  createdAt: string
  createdBy: Actor
  updatedAt: string
  updatedBy: Actor
}

export type AuditLog = {
  auditId: string
  entityType: 'reservation' | 'categorySetting' | 'closure' | 'demo'
  entityId: string
  action: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  actor: Actor
  occurredAt: string
  relatedReservationId?: string
  note?: string
}

export type OperationResultPayload = {
  reservationId?: string
  reservationCode?: string
  version?: number
  generationId: string
}

export type IdempotencyRecord = {
  idempotencyKey: string
  generationId: string
  requestFingerprint: string
  operation: string
  targetEntityId?: string
  resultKind: 'success'
  resultPayload: OperationResultPayload
  createdAt: string
}

export type DemoMetadata = {
  key: 'demo'
  schemaVersion: number
  seedVersion: string
  generationId: string
  lifecycleState: 'active' | 'deleted'
  lastUsedAt: string
  updatedAt: string
}
