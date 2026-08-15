/**
 * ScaleMule Signals — protocol types.
 *
 * A Signal is a structured description of something a participant in an
 * application (human, agent, application, operator, developer) should know,
 * understand, or act upon. Applications emit meaning; the runtime decides
 * presentation, agent exposure, and telemetry.
 *
 * See docs/ADR-2026-08-15-scalemule-signals.md in the ScaleMule meta-repo.
 */

export type SignalKind = 'error' | 'warning' | 'info' | 'success' | 'progress' | 'confirmation'

export type SignalSeverity = 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical'

export type SignalScope =
  | { type: 'field'; field: string; formId?: string }
  | { type: 'control'; controlId: string }
  | { type: 'form'; formId: string }
  | { type: 'item'; itemId: string; collectionId?: string }
  | { type: 'region'; regionId: string }
  | { type: 'page'; pageId?: string }
  | { type: 'workspace'; workspaceId?: string }
  | { type: 'application' }
  | { type: 'system' }
  | { type: 'background' }
  /** A discrete user action with no owning region (legacy toast territory). */
  | { type: 'action'; actionId?: string }

export type SignalScopeType = SignalScope['type']

export type SignalPersistence = 'transient' | 'until_acknowledged' | 'until_resolved'
export type SignalInterruptiveness = 'none' | 'polite' | 'interruptive'
export type SignalRecoverability = 'automatic' | 'retry' | 'user_action' | 'admin_action' | 'none'

export type SignalActionType =
  | 'retry'
  | 'undo'
  | 'dismiss'
  | 'navigate'
  | 'authenticate'
  | 'refresh'
  | 'edit'
  | 'open'
  | 'contact_support'
  | 'request_permission'
  | 'wait'
  | 'agent_action'
  | 'custom'

export interface SignalAction {
  id: string
  type: SignalActionType
  label: string
  /** For navigate/authenticate/open. */
  destination?: string
  primary?: boolean
  /** Runtime handler (client-only; never serialized). */
  onSelect?: (signal: Signal) => void | Promise<void>
  /** Whether an agent may execute this action without a human. */
  automaticAllowed?: boolean
}

export interface SignalTarget {
  type: string
  id: string
  label?: string
}

export interface SignalOperation {
  name: string
  correlationId?: string
  initiatedBy?: 'user' | 'agent' | 'system' | 'schedule'
  initiatorId?: string
}

export interface SignalCause {
  code?: string
  message?: string
  /** Parent signal id when this signal is a child in a cascade. */
  parentId?: string
}

export interface SignalResolution {
  owner: 'user' | 'application' | 'agent' | 'admin' | 'external_system'
  options?: Array<{ action: SignalActionType; automaticAllowed?: boolean }>
  expectedResolution?: 'immediate' | 'temporary' | 'unknown'
}

export interface SignalTelemetry {
  requestId?: string
  traceId?: string
  spanId?: string
  release?: string
  /** Free-form, redacted per `visibility.telemetry`. */
  attributes?: Record<string, string | number | boolean>
}

export type SignalVisibilityLevel = 'full' | 'safe' | 'redacted' | 'none'

export interface SignalVisibility {
  user?: SignalVisibilityLevel
  agent?: SignalVisibilityLevel
  telemetry?: SignalVisibilityLevel
  developer?: SignalVisibilityLevel
}

export interface SignalAgentView {
  summary?: string
  reason?: string
  recommendedAction?: SignalActionType
  safeToRetry?: boolean
  permissions?: Array<'observe' | 'explain' | 'suggest' | 'execute'>
}

export interface SignalDeveloperView {
  exception?: string
  service?: string
  status?: number
  url?: string
  method?: string
  details?: unknown
}

export type SignalLifecycle = 'created' | 'active' | 'acknowledged' | 'resolving' | 'resolved' | 'superseded'

export interface Signal {
  id: string
  code: string
  kind: SignalKind
  severity: SignalSeverity
  title?: string
  message: string
  explanation?: string
  cause?: SignalCause
  resolution?: SignalResolution
  scope: SignalScope
  target?: SignalTarget
  operation?: SignalOperation
  persistence: SignalPersistence
  interruptiveness: SignalInterruptiveness
  recoverability?: SignalRecoverability
  actions: SignalAction[]
  telemetry?: SignalTelemetry
  visibility?: SignalVisibility
  agent?: SignalAgentView
  developer?: SignalDeveloperView
  /** Message template parameters (localization / analytics). */
  params?: Record<string, string | number | boolean>
  /** Where in the app this was raised (component/route), for telemetry. */
  origin?: string
  source: 'server' | 'client' | 'network' | 'validation' | 'boundary'
  timestamp: string
  lifecycle: SignalLifecycle
  /** Signals this one aggregates (ids). */
  aggregates?: string[]
  /** For progress kind: 0..1 when determinate. */
  progress?: number
  /** Caller-supplied dedup key (overrides code+operation+target+scope). */
  dedupKey?: string
}

/** What a caller passes in — everything optional except message; defaults come from the registry + resolver. */
export type SignalInput = Partial<Omit<Signal, 'id' | 'timestamp' | 'lifecycle' | 'actions'>> & {
  message: string
  actions?: SignalAction[]
  /** Optional caller-supplied dedup key override. */
  dedupKey?: string
  /** Auto-dismiss after ms (only honored for transient persistence). */
  ttlMs?: number
}

export type SignalSurface =
  | 'field'
  | 'control'
  | 'form-summary'
  | 'item'
  | 'region'
  | 'page'
  | 'banner'
  | 'status-bar'
  | 'callout'
  | 'dialog'
  | 'notification'
  | 'progress'
  | 'silent'

export interface SignalPresentation {
  surface: SignalSurface
  /** Key used by renderers to claim ownership, e.g. "region:customer-details". */
  ownerKey: string
  /** ARIA live politeness derived from interruptiveness. */
  live: 'off' | 'polite' | 'assertive'
  role: 'alert' | 'status' | 'none'
  autoDismissMs?: number
  focus?: boolean
}

export interface RegistryEntry {
  code: string
  kind?: SignalKind
  severity?: SignalSeverity
  scope?: SignalScope
  recoverability?: SignalRecoverability
  persistence?: SignalPersistence
  interruptiveness?: SignalInterruptiveness
  title?: string
  /** Default message; may contain {param} placeholders. */
  message?: string
  actions?: SignalAction[]
  agent?: SignalAgentView
  helpUrl?: string
  /** Legacy identifiers (e.g. SCREAMING_SNAKE backend codes) that map to this code. */
  aliases?: string[]
  presentation?: Partial<Pick<SignalPresentation, 'surface' | 'autoDismissMs'>>
}

export type SignalEventName =
  | 'signal.created'
  | 'signal.presented'
  | 'signal.action_selected'
  | 'signal.retry_started'
  | 'signal.acknowledged'
  | 'signal.resolved'
  | 'signal.dismissed'
  | 'signal.superseded'
  | 'signal.escalated'

export interface SignalEvent {
  name: SignalEventName
  signal: Signal
  at: string
  presentation?: SignalPresentation
  action?: SignalAction
  durationMs?: number
}

export interface SignalAdapter {
  name: string
  onEvent(event: SignalEvent): void
}
