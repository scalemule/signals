import type { RegistryEntry, Signal, SignalInput } from './types'

/**
 * Signal Registry — stable codes with default semantics so good UX is the default.
 * Codes are hierarchical, dotted, lowercase. `aliases` accept legacy identifiers
 * (e.g. ScaleMule backend SCREAMING_SNAKE codes) during migration.
 */
export class SignalRegistry {
  private entries = new Map<string, RegistryEntry>()
  private aliasIndex = new Map<string, string>()

  register(entry: RegistryEntry | RegistryEntry[]): this {
    for (const e of Array.isArray(entry) ? entry : [entry]) {
      this.entries.set(e.code, e)
      for (const a of e.aliases ?? []) this.aliasIndex.set(a, e.code)
    }
    return this
  }

  /** Resolve a code or alias to a canonical registry code (or return input untouched). */
  canonical(codeOrAlias: string | undefined): string | undefined {
    if (!codeOrAlias) return undefined
    if (this.entries.has(codeOrAlias)) return codeOrAlias
    return this.aliasIndex.get(codeOrAlias) ?? codeOrAlias
  }

  get(code: string | undefined): RegistryEntry | undefined {
    const c = this.canonical(code)
    return c ? this.entries.get(c) : undefined
  }

  has(code: string): boolean {
    return this.entries.has(this.canonical(code) ?? '')
  }

  list(): RegistryEntry[] {
    return [...this.entries.values()]
  }

  /** Apply registry defaults to caller input (caller wins on every field it set). */
  applyDefaults(input: SignalInput): SignalInput {
    const entry = this.get(input.code)
    if (!entry) return input
    const out: SignalInput = { ...input, code: entry.code }
    if (!input.kind && entry.kind) out.kind = entry.kind
    if (!input.severity && entry.severity) out.severity = entry.severity
    if (!input.scope && entry.scope) out.scope = entry.scope
    if (!input.recoverability && entry.recoverability) out.recoverability = entry.recoverability
    if (!input.persistence && entry.persistence) out.persistence = entry.persistence
    if (!input.interruptiveness && entry.interruptiveness) out.interruptiveness = entry.interruptiveness
    if (!input.title && entry.title) out.title = entry.title
    if ((!input.message || input.message.length === 0) && entry.message) out.message = renderTemplate(entry.message, input.params)
    if ((!input.actions || input.actions.length === 0) && entry.actions) out.actions = entry.actions
    if (!input.agent && entry.agent) out.agent = entry.agent
    return out
  }
}

export function renderTemplate(template: string, params?: Signal['params']): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in params ? String(params[k]) : `{${k}}`))
}

/** Platform-wide defaults shipped with the SDK. Apps extend via `signals.registry.register(...)`. */
export const DEFAULT_REGISTRY: RegistryEntry[] = [
  {
    code: 'auth.session.expired',
    aliases: ['SESSION_EXPIRED', 'EXPIRED_SESSION', 'session_expired', 'token_expired'],
    kind: 'warning',
    severity: 'warning',
    scope: { type: 'application' },
    recoverability: 'user_action',
    persistence: 'until_resolved',
    interruptiveness: 'polite',
    title: 'Session expired',
    message: 'Your session has expired. Sign in again to continue.',
    actions: [{ id: 'sign-in', type: 'authenticate', label: 'Sign in', destination: '/login', primary: true }],
    agent: { permissions: ['observe', 'explain'], recommendedAction: 'authenticate', safeToRetry: false },
  },
  {
    code: 'auth.session.invalid',
    aliases: ['INVALID_SESSION', 'UNAUTHORIZED', 'unauthorized', 'invalid_session'],
    kind: 'warning',
    severity: 'warning',
    scope: { type: 'application' },
    recoverability: 'user_action',
    persistence: 'until_resolved',
    title: 'Sign-in required',
    message: 'Sign in to continue.',
    actions: [{ id: 'sign-in', type: 'authenticate', label: 'Sign in', destination: '/login', primary: true }],
  },
  {
    code: 'auth.credentials.invalid',
    aliases: ['INVALID_CREDENTIALS', 'invalid_credentials'],
    kind: 'error',
    severity: 'error',
    recoverability: 'user_action',
    persistence: 'until_resolved',
    title: 'Sign-in failed',
    message: 'The email or password is incorrect.',
  },
  {
    code: 'permissions.denied',
    aliases: ['FORBIDDEN', 'forbidden', 'permission_denied'],
    kind: 'error',
    severity: 'error',
    recoverability: 'admin_action',
    persistence: 'until_resolved',
    title: 'Access denied',
    message: "You don't have permission to do that.",
    agent: { permissions: ['observe', 'explain'], safeToRetry: false },
  },
  {
    code: 'network.offline',
    kind: 'warning',
    severity: 'warning',
    scope: { type: 'system' },
    recoverability: 'automatic',
    persistence: 'until_resolved',
    interruptiveness: 'polite',
    message: "You're offline. Reconnecting…",
    agent: { permissions: ['observe', 'explain'], recommendedAction: 'wait', safeToRetry: true },
  },
  {
    code: 'network.request_failed',
    aliases: ['network_error', 'NETWORK_ERROR'],
    kind: 'error',
    severity: 'error',
    recoverability: 'retry',
    persistence: 'until_resolved',
    title: 'Connection problem',
    message: "We couldn't reach the server. Check your connection and try again.",
    agent: { permissions: ['observe', 'explain', 'suggest', 'execute'], recommendedAction: 'retry', safeToRetry: true },
  },
  {
    code: 'request.timeout',
    aliases: ['timeout', 'TIMEOUT'],
    kind: 'error',
    severity: 'error',
    recoverability: 'retry',
    persistence: 'until_resolved',
    message: 'The request took too long. Try again.',
    agent: { recommendedAction: 'retry', safeToRetry: true },
  },
  {
    code: 'validation.invalid_input',
    aliases: ['INVALID_INPUT', 'INVALID_FORMAT', 'MISSING_FIELD', 'validation_error', 'invalid_input'],
    kind: 'error',
    severity: 'error',
    recoverability: 'user_action',
    persistence: 'until_resolved',
    message: 'Check the highlighted field.',
  },
  {
    code: 'resource.not_found',
    aliases: ['NOT_FOUND', 'RESOURCE_NOT_FOUND', 'not_found'],
    kind: 'error',
    severity: 'error',
    recoverability: 'none',
    persistence: 'until_resolved',
    title: 'Not found',
    message: "We couldn't find what you were looking for.",
  },
  {
    code: 'resource.conflict',
    aliases: ['CONFLICT', 'ALREADY_EXISTS', 'conflict', 'already_exists'],
    kind: 'error',
    severity: 'error',
    recoverability: 'user_action',
    persistence: 'until_resolved',
    message: 'This conflicts with an existing item.',
  },
  {
    code: 'rate_limit.exceeded',
    aliases: ['RATE_LIMIT_EXCEEDED', 'rate_limited'],
    kind: 'warning',
    severity: 'warning',
    recoverability: 'retry',
    persistence: 'until_resolved',
    message: 'Too many requests. Wait a moment and try again.',
    agent: { recommendedAction: 'wait', safeToRetry: true },
  },
  {
    code: 'quota.exceeded',
    aliases: ['QUOTA_EXCEEDED', 'quota_exceeded'],
    kind: 'warning',
    severity: 'warning',
    recoverability: 'admin_action',
    persistence: 'until_resolved',
    message: 'This plan’s limit has been reached.',
  },
  {
    code: 'service.unavailable',
    aliases: ['INTERNAL_ERROR', 'DATABASE_ERROR', 'EXTERNAL_SERVICE_ERROR', 'internal_error', 'service_unavailable', 'server_error'],
    kind: 'error',
    severity: 'error',
    recoverability: 'retry',
    persistence: 'until_resolved',
    title: 'Something went wrong',
    message: "We couldn't complete that. Try again in a moment.",
    agent: { recommendedAction: 'retry', safeToRetry: true },
  },
  {
    code: 'tenant.relocating',
    aliases: ['TENANT_RELOCATING', 'PLACEMENT_UNAVAILABLE'],
    kind: 'warning',
    severity: 'warning',
    scope: { type: 'application' },
    recoverability: 'retry',
    persistence: 'until_resolved',
    message: 'This workspace is being moved. Try again shortly.',
    agent: { recommendedAction: 'wait', safeToRetry: true },
  },
]
