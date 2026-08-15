import type { SignalAdapter, SignalEvent } from './types'

/** Flatten a SignalEvent into OpenTelemetry-style attributes (honours visibility.telemetry). */
export function toTelemetryAttributes(event: SignalEvent, extra: Record<string, string | number | boolean | undefined> = {}): Record<string, string | number | boolean> {
  const s = event.signal
  const redacted = s.visibility?.telemetry === 'redacted' || s.visibility?.telemetry === 'none'
  const attrs: Record<string, string | number | boolean | undefined> = {
    'signal.event': event.name,
    'signal.id': s.id,
    'signal.code': s.code,
    'signal.kind': s.kind,
    'signal.severity': s.severity,
    'signal.scope': s.scope.type,
    'signal.scope_key': scopeKey(s.scope),
    'signal.persistence': s.persistence,
    'signal.recoverability': s.recoverability,
    'signal.source': s.source,
    'signal.operation': s.operation?.name,
    'signal.target.type': s.target?.type,
    'signal.target.id': redacted ? undefined : s.target?.id,
    'signal.presentation': event.presentation?.surface,
    'signal.action': event.action?.type,
    'signal.duration_ms': event.durationMs,
    'signal.origin': s.origin,
    'signal.message': redacted ? undefined : s.message,
    'request.id': s.telemetry?.requestId,
    'trace.id': s.telemetry?.traceId,
    ...extra,
  }
  const out: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) out[k] = v
  return out
}

function scopeKey(scope: SignalEvent['signal']['scope']): string {
  const s = scope as Record<string, unknown>
  const id = s.field ?? s.formId ?? s.itemId ?? s.regionId ?? s.controlId ?? s.pageId ?? s.actionId ?? ''
  return id ? `${scope.type}:${id}` : scope.type
}

/** Console adapter for development. */
export function consoleAdapter(opts: { level?: 'debug' | 'info' } = {}): SignalAdapter {
  return {
    name: 'console',
    onEvent(event) {
      const fn = opts.level === 'info' ? console.info : console.debug
      fn(`[signals] ${event.name}`, toTelemetryAttributes(event))
    },
  }
}

/**
 * Sentry adapter — breadcrumbs for every event, and captureMessage for presented errors
 * that are not client-validation, so UI-visible failures show up joined by request.id.
 * Pass the Sentry module (or any object with the same two functions).
 */
export type SentryLevel = 'fatal' | 'error' | 'warning' | 'log' | 'info' | 'debug'

export function sentryAdapter(sentry: {
  addBreadcrumb: (b: { category?: string; message?: string; level?: SentryLevel; data?: Record<string, unknown> }) => void
  captureMessage?: (msg: string, ctx?: any) => unknown
}, opts: { captureErrors?: boolean } = {}): SignalAdapter {
  return {
    name: 'sentry',
    onEvent(event) {
      const attrs = toTelemetryAttributes(event)
      sentry.addBreadcrumb({
        category: 'signal',
        message: `${event.name} ${event.signal.code}`,
        level: (event.signal.kind === 'error' ? 'error' : event.signal.kind === 'warning' ? 'warning' : 'info') as SentryLevel,
        data: attrs,
      })
      if (opts.captureErrors && event.name === 'signal.presented' && event.signal.kind === 'error' && event.signal.source === 'server' && sentry.captureMessage) {
        sentry.captureMessage(`[signal] ${event.signal.code}`, { level: 'error', tags: { 'signal.code': event.signal.code, 'request.id': event.signal.telemetry?.requestId ?? '' }, extra: attrs })
      }
    },
  }
}

/**
 * Batched HTTP adapter (e.g. ScaleMule logger `POST /v1/logger/signals` when it ships,
 * or any collector). Uses sendBeacon on page hide when available.
 */
export function httpAdapter(opts: {
  url: string
  headers?: Record<string, string>
  flushIntervalMs?: number
  maxBatch?: number
  context?: () => Record<string, string | number | boolean | undefined>
  fetchImpl?: typeof fetch
}): SignalAdapter & { flush: () => void } {
  const queue: Array<Record<string, string | number | boolean>> = []
  const flushMs = opts.flushIntervalMs ?? 3000
  const maxBatch = opts.maxBatch ?? 50
  let timer: ReturnType<typeof setTimeout> | undefined
  const send = (useBeacon = false) => {
    if (!queue.length) return
    const batch = queue.splice(0, queue.length)
    const body = JSON.stringify({ events: batch })
    if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(opts.url, new Blob([body], { type: 'application/json' }))
      return
    }
    const f = opts.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined)
    if (!f) return
    void f(opts.url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) }, body, keepalive: true, credentials: 'include' }).catch(() => {})
  }
  const schedule = () => {
    if (timer) return
    timer = setTimeout(() => {
      timer = undefined
      send()
    }, flushMs)
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') send(true)
    })
  }
  return {
    name: 'http',
    onEvent(event) {
      queue.push({ ...toTelemetryAttributes(event, opts.context?.()), at: event.at })
      if (queue.length >= maxBatch) send()
      else schedule()
    },
    flush: () => send(),
  }
}
