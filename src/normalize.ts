import type { SignalAction, SignalInput, SignalKind, SignalRecoverability, SignalScope, SignalSeverity } from './types'

/**
 * Normalizers: turn wire errors (ScaleMule envelope, RFC 9457 Problem Details,
 * bare gateway/WS shapes, SDK error classes, fetch/network failures) into
 * SignalInput. Presentation semantics are added later by the registry + resolver.
 */

export interface ProblemLike {
  // RFC 9457
  type?: string
  title?: string
  status?: number
  detail?: string
  instance?: string
  // ScaleMule / Stripe-ish extensions
  code?: string
  message?: string
  field?: string | null
  param?: string
  domain?: string
  kind?: SignalKind
  severity?: SignalSeverity
  scope?: SignalScope
  recoverability?: SignalRecoverability
  retryable?: boolean
  retry_after_ms?: number
  retryAfterMs?: number
  actions?: SignalAction[]
  help_url?: string
  helpUrl?: string
  doc_url?: string
  request_id?: string
  requestId?: string
  trace_id?: string
  traceId?: string
  errors?: Array<{ code?: string; message?: string; field?: string; detail?: string; pointer?: string }>
  details?: unknown
}

export interface NormalizeContext {
  status?: number
  url?: string
  method?: string
  requestId?: string
  traceId?: string
  /** Fallback message when nothing usable is in the payload. */
  fallbackMessage?: string
  /** Where the caller wants the signal to live if the payload doesn't say. */
  scope?: SignalScope
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** Extract the problem object from any of the shapes ScaleMule surfaces today. */
export function extractProblem(body: unknown): ProblemLike | undefined {
  if (!isObj(body)) return undefined
  // ScaleMule envelope: { success:false, error:{...}, meta:{request_id} }
  if (isObj(body.error)) {
    const meta = isObj(body.meta) ? (body.meta as Record<string, unknown>) : {}
    return { ...(body.error as ProblemLike), request_id: (meta.request_id as string) ?? (body.error as ProblemLike).request_id, trace_id: (meta.trace_id as string) ?? undefined }
  }
  // Gateway / WS: { error: "string" }
  if (typeof body.error === 'string') return { message: body.error }
  // RFC 9457 or flat SDK ApiError { code, message, status }
  if ('type' in body || 'title' in body || 'detail' in body || 'code' in body || 'message' in body) return body as ProblemLike
  return undefined
}

export function statusToCode(status: number | undefined): string | undefined {
  if (!status) return undefined
  if (status === 401) return 'auth.session.invalid'
  if (status === 403) return 'permissions.denied'
  if (status === 404) return 'resource.not_found'
  if (status === 408 || status === 504) return 'request.timeout'
  if (status === 409) return 'resource.conflict'
  if (status === 422 || status === 400) return 'validation.invalid_input'
  if (status === 429) return 'rate_limit.exceeded'
  if (status === 402) return 'quota.exceeded'
  if (status >= 500) return 'service.unavailable'
  return undefined
}

function kindForStatus(status?: number): SignalKind {
  if (status === 401 || status === 429 || status === 402) return 'warning'
  return 'error'
}

/** Derive a code from an RFC 9457 `type` URI, e.g. https://errors.scalemule.com/customer/email-invalid → customer.email_invalid */
export function codeFromTypeUri(type: string | undefined): string | undefined {
  if (!type || type === 'about:blank') return undefined
  try {
    const path = type.startsWith('http') ? new URL(type).pathname : type
    const parts = path.split('/').filter(Boolean)
    if (parts[0] === 'errors') parts.shift()
    if (!parts.length) return undefined
    return parts.map((p) => p.replace(/-/g, '_')).join('.').toLowerCase()
  } catch {
    return undefined
  }
}

export function fromProblem(problem: ProblemLike, ctx: NormalizeContext = {}): SignalInput {
  const status = problem.status ?? ctx.status
  const code = problem.code ?? codeFromTypeUri(problem.type) ?? statusToCode(status) ?? 'request.failed'
  const message = problem.message ?? problem.detail ?? problem.title ?? ctx.fallbackMessage ?? 'Something went wrong.'
  const field = problem.field ?? problem.param ?? undefined
  const requestId = problem.request_id ?? problem.requestId ?? ctx.requestId ?? instanceToRequestId(problem.instance)
  const traceId = problem.trace_id ?? problem.traceId ?? ctx.traceId
  const scope: SignalScope | undefined = problem.scope ?? (field ? { type: 'field', field } : ctx.scope)
  const retryable = problem.retryable
  const recoverability =
    problem.recoverability ?? (retryable === true ? 'retry' : field ? 'user_action' : undefined)

  const input: SignalInput = {
    code,
    kind: problem.kind ?? kindForStatus(status),
    severity: problem.severity,
    title: problem.title && problem.title !== message ? problem.title : undefined,
    message,
    scope,
    recoverability,
    actions: problem.actions,
    source: 'server',
    telemetry: requestId || traceId ? { requestId, traceId } : undefined,
    developer: { status, url: ctx.url, method: ctx.method, details: problem.details },
  }
  const help = problem.help_url ?? problem.helpUrl ?? problem.doc_url
  if (help) input.actions = [...(input.actions ?? []), { id: 'help', type: 'open', label: 'Learn more', destination: help }]
  const retryAfter = problem.retry_after_ms ?? problem.retryAfterMs
  if (retryAfter) input.params = { ...(input.params ?? {}), retryAfterMs: retryAfter }
  return input
}

/** Multi-field validation: one child SignalInput per entry, plus the parent. */
export function fromProblemWithChildren(problem: ProblemLike, ctx: NormalizeContext = {}): { parent: SignalInput; children: SignalInput[] } {
  const parent = fromProblem(problem, ctx)
  const children = (problem.errors ?? []).map((e) => {
    const field = e.field ?? pointerToField(e.pointer)
    return {
      code: e.code ?? 'validation.invalid_input',
      kind: 'error' as const,
      message: e.message ?? e.detail ?? 'Invalid value.',
      scope: field ? ({ type: 'field', field } as SignalScope) : parent.scope,
      recoverability: 'user_action' as const,
      source: 'server' as const,
      telemetry: parent.telemetry,
    }
  })
  return { parent, children }
}

function pointerToField(pointer?: string): string | undefined {
  if (!pointer) return undefined
  const parts = pointer.split('/').filter(Boolean)
  if (parts[0] === 'data' && parts[1] === 'attributes') return parts.slice(2).join('.')
  return parts.join('.')
}

function instanceToRequestId(instance?: string): string | undefined {
  if (!instance) return undefined
  const m = /req_[A-Za-z0-9-]+/.exec(instance)
  return m ? m[0] : undefined
}

/**
 * Normalize anything thrown in a client (SDK errors, fetch TypeError, Error, string,
 * ScaleMule admin ApiError { status, data, url }).
 */
export function fromError(err: unknown, ctx: NormalizeContext = {}): SignalInput {
  if (isObj(err)) {
    const e = err as Record<string, unknown>
    // Admin ApiError / SDK error carrying the raw body
    const body = e.data ?? e.body ?? e.response
    const status = (typeof e.status === 'number' ? e.status : undefined) ?? ctx.status
    const problem = extractProblem(body) ?? (typeof e.code === 'string' || typeof e.message === 'string' ? (e as ProblemLike) : undefined)
    if (problem && (problem.code || problem.detail || problem.type || (problem.message && problem !== e))) {
      const out = fromProblem(problem, { ...ctx, status, url: (e.url as string) ?? ctx.url })
      if (!out.telemetry?.requestId && typeof e.requestId === 'string') out.telemetry = { ...(out.telemetry ?? {}), requestId: e.requestId }
      return out
    }
    if (typeof e.message === 'string') {
      const isNetwork = e.name === 'TypeError' && /fetch|network|Failed to fetch|Load failed/i.test(e.message)
      const isAbort = e.name === 'AbortError'
      return {
        code: isNetwork ? 'network.request_failed' : isAbort ? 'request.aborted' : (typeof e.code === 'string' ? e.code : statusToCode(status)) ?? 'client.error',
        kind: 'error',
        message: isNetwork ? "We couldn't reach the server. Check your connection and try again." : e.message || ctx.fallbackMessage || 'Something went wrong.',
        scope: ctx.scope,
        source: isNetwork ? 'network' : 'client',
        recoverability: isNetwork ? 'retry' : undefined,
        developer: { exception: typeof e.name === 'string' ? e.name : undefined, status, url: ctx.url },
      }
    }
  }
  return {
    code: statusToCode(ctx.status) ?? 'client.error',
    kind: 'error',
    message: typeof err === 'string' ? err : ctx.fallbackMessage ?? 'Something went wrong.',
    scope: ctx.scope,
    source: 'client',
  }
}
