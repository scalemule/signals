import { DEFAULT_REGISTRY, SignalRegistry } from './registry'
import { fallbackKeys, ownerKeyFor, resolveSignal, type PresentationPolicy } from './resolver'
import { fromError, fromProblem, fromProblemWithChildren, type NormalizeContext, type ProblemLike } from './normalize'
import type {
  RegistryEntry,
  Signal,
  SignalAction,
  SignalAdapter,
  SignalEvent,
  SignalEventName,
  SignalInput,
  SignalKind,
  SignalLifecycle,
  SignalPresentation,
  SignalScope,
} from './types'

export interface SignalHubOptions {
  registry?: RegistryEntry[]
  policy?: PresentationPolicy
  adapters?: SignalAdapter[]
  /** Called for every publish in development to catch missing codes. */
  onWarn?: (msg: string) => void
  idFactory?: () => string
  now?: () => Date
}

export interface SignalState {
  signals: Signal[]
  /** Monotonic version for cheap change detection. */
  version: number
}

export interface Claim {
  key: string
  rendererId: string
  priority: number
}

export interface RunMeta {
  operation: string
  scope?: SignalScope
  target?: Signal['target']
  /** Publish a progress signal while running. */
  progressMessage?: string
  /** Publish a success signal after completion. */
  successMessage?: string
  successScope?: SignalScope
  fallbackMessage?: string
  origin?: string
}

const uuid = (): string => {
  const g = globalThis as { crypto?: { randomUUID?: () => string } }
  if (g.crypto?.randomUUID) return g.crypto.randomUUID()
  return 'sig_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

const KIND_SEVERITY: Record<SignalKind, Signal['severity']> = {
  error: 'error',
  warning: 'warning',
  info: 'info',
  success: 'info',
  progress: 'info',
  confirmation: 'notice',
}

export class SignalHub {
  readonly registry: SignalRegistry
  policy: PresentationPolicy
  private adapters: SignalAdapter[]
  private state: SignalState = { signals: [], version: 0 }
  private listeners = new Set<() => void>()
  private claims = new Map<string, Claim[]>()
  private claimListeners = new Set<() => void>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private presentedOnce = new Set<string>()
  private createdAt = new Map<string, number>()
  private onWarn?: (msg: string) => void
  private idFactory: () => string
  private now: () => Date

  constructor(opts: SignalHubOptions = {}) {
    this.registry = new SignalRegistry().register(DEFAULT_REGISTRY)
    if (opts.registry) this.registry.register(opts.registry)
    this.policy = opts.policy ?? {}
    this.adapters = [...(opts.adapters ?? [])]
    this.onWarn = opts.onWarn
    this.idFactory = opts.idFactory ?? uuid
    this.now = opts.now ?? (() => new Date())
  }

  // ───────────────────────── adapters / telemetry ─────────────────────────

  use(adapter: SignalAdapter): () => void {
    this.adapters.push(adapter)
    return () => {
      this.adapters = this.adapters.filter((a) => a !== adapter)
    }
  }

  private emit(name: SignalEventName, signal: Signal, extra: Partial<SignalEvent> = {}) {
    const started = this.createdAt.get(signal.id)
    const event: SignalEvent = {
      name,
      signal,
      at: this.now().toISOString(),
      durationMs: started ? Date.now() - started : undefined,
      ...extra,
    }
    for (const a of this.adapters) {
      try {
        a.onEvent(event)
      } catch (err) {
        this.onWarn?.(`[signals] adapter ${a.name} threw: ${String(err)}`)
      }
    }
  }

  // ───────────────────────── state / subscription ─────────────────────────

  getState = (): SignalState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private setSignals(next: Signal[]) {
    this.state = { signals: next, version: this.state.version + 1 }
    for (const l of this.listeners) l()
  }

  private update(id: string, patch: Partial<Signal>): Signal | undefined {
    let out: Signal | undefined
    this.setSignals(
      this.state.signals.map((s) => {
        if (s.id !== id) return s
        out = { ...s, ...patch }
        return out
      })
    )
    return out
  }

  // ───────────────────────── publish ─────────────────────────

  private materialize(raw: SignalInput): Signal {
    const input = this.registry.applyDefaults(raw)
    const kind: SignalKind = input.kind ?? 'info'
    const scope: SignalScope = input.scope ?? { type: 'action' }
    const isProblem = kind === 'error' || kind === 'warning'
    const persistence = input.persistence ?? (isProblem ? 'until_resolved' : kind === 'progress' ? 'until_resolved' : 'transient')
    const interruptiveness =
      input.interruptiveness ?? (kind === 'error' && (scope.type === 'application' || scope.type === 'system' || scope.type === 'page') ? 'interruptive' : isProblem ? 'polite' : kind === 'success' ? 'polite' : 'none')
    if (!input.code) this.onWarn?.(`[signals] publish without code: "${input.message}" — add a registry code for analytics.`)
    return {
      id: this.idFactory(),
      code: input.code ?? `${kind}.uncoded`,
      kind,
      severity: input.severity ?? KIND_SEVERITY[kind],
      title: input.title,
      message: input.message,
      explanation: input.explanation,
      cause: input.cause,
      resolution: input.resolution,
      scope,
      target: input.target,
      operation: input.operation,
      persistence,
      interruptiveness,
      recoverability: input.recoverability,
      actions: input.actions ?? [],
      telemetry: input.telemetry,
      visibility: input.visibility,
      agent: input.agent,
      developer: input.developer,
      params: input.params,
      origin: input.origin,
      source: input.source ?? 'client',
      timestamp: this.now().toISOString(),
      lifecycle: 'active',
      progress: input.progress,
      dedupKey: input.dedupKey,
    }
  }

  dedupKey(signal: Pick<Signal, 'code' | 'operation' | 'target' | 'scope' | 'dedupKey'>, override?: string): string {
    if (override) return override
    if (signal.dedupKey) return signal.dedupKey
    return [signal.code, signal.operation?.name ?? '', signal.target ? `${signal.target.type}:${signal.target.id}` : '', ownerKeyFor(signal.scope)].join('|')
  }

  publish(raw: SignalInput): Signal {
    const signal = this.materialize(raw)
    const key = this.dedupKey(signal)
    const existing = this.state.signals.find((s) => s.lifecycle !== 'resolved' && s.lifecycle !== 'superseded' && this.dedupKey(s) === key)
    if (existing) {
      // Collapse: refresh the existing signal instead of stacking a duplicate.
      const updated = this.update(existing.id, {
        message: signal.message,
        title: signal.title ?? existing.title,
        actions: signal.actions.length ? signal.actions : existing.actions,
        telemetry: signal.telemetry ?? existing.telemetry,
        timestamp: signal.timestamp,
        lifecycle: 'active',
        progress: signal.progress,
        aggregates: [...(existing.aggregates ?? []), signal.id],
      })!
      this.armTimer(updated, raw.ttlMs)
      return updated
    }
    this.createdAt.set(signal.id, Date.now())
    this.setSignals([...this.state.signals, signal])
    this.emit('signal.created', signal)
    this.armTimer(signal, raw.ttlMs)
    return signal
  }

  private armTimer(signal: Signal, ttlMs?: number) {
    const pres = resolveSignal(signal, this.policy)
    const ms = ttlMs ?? pres.autoDismissMs
    const prev = this.timers.get(signal.id)
    if (prev) clearTimeout(prev)
    if (ms && signal.persistence === 'transient') {
      const t = setTimeout(() => this.dismiss(signal.id, 'timeout'), ms)
      this.timers.set(signal.id, t)
    }
  }

  error(message: string, opts: Omit<SignalInput, 'message' | 'kind'> = {}): Signal {
    return this.publish({ ...opts, message, kind: 'error' })
  }
  warning(message: string, opts: Omit<SignalInput, 'message' | 'kind'> = {}): Signal {
    return this.publish({ ...opts, message, kind: 'warning' })
  }
  info(message: string, opts: Omit<SignalInput, 'message' | 'kind'> = {}): Signal {
    return this.publish({ ...opts, message, kind: 'info' })
  }
  success(message: string, opts: Omit<SignalInput, 'message' | 'kind'> = {}): Signal {
    return this.publish({ ...opts, message, kind: 'success' })
  }
  progress(message: string, opts: Omit<SignalInput, 'message' | 'kind'> = {}): Signal {
    return this.publish({ ...opts, message, kind: 'progress' })
  }
  confirm(message: string, opts: Omit<SignalInput, 'message' | 'kind'> = {}): Signal {
    return this.publish({ ...opts, message, kind: 'confirmation' })
  }

  /** Normalize a wire problem (ScaleMule envelope / RFC 9457) and publish it (plus field children). */
  report(problemOrError: unknown, ctx: NormalizeContext = {}): Signal {
    const problem = isProblemLike(problemOrError) ? (problemOrError as ProblemLike) : undefined
    if (problem && problem.errors?.length) {
      const { parent, children } = fromProblemWithChildren(problem, ctx)
      const p = this.publish(parent)
      for (const c of children) this.publish({ ...c, cause: { parentId: p.id } })
      return p
    }
    return this.publish(problem ? fromProblem(problem, ctx) : fromError(problemOrError, ctx))
  }

  /** Wrap an async operation: progress → success/failure signals with operation context. */
  async run<T>(meta: RunMeta, fn: () => Promise<T>): Promise<T> {
    const operation = { name: meta.operation }
    let progress: Signal | undefined
    if (meta.progressMessage) {
      progress = this.progress(meta.progressMessage, { scope: meta.scope ?? { type: 'action', actionId: meta.operation }, operation, target: meta.target, origin: meta.origin })
    }
    try {
      const result = await fn()
      if (progress) this.resolve(progress.id)
      // A successful run resolves prior failures of the same operation.
      this.resolveWhere((s) => s.operation?.name === meta.operation && (s.kind === 'error' || s.kind === 'warning'))
      if (meta.successMessage) {
        this.success(meta.successMessage, { scope: meta.successScope ?? { type: 'action', actionId: meta.operation }, operation, target: meta.target, origin: meta.origin })
      }
      return result
    } catch (err) {
      if (progress) this.resolve(progress.id)
      const input = fromError(err, { scope: meta.scope, fallbackMessage: meta.fallbackMessage })
      const actions: SignalAction[] = [
        ...(input.actions ?? []),
        { id: 'retry', type: 'retry', label: 'Try again', primary: true, onSelect: () => void this.run(meta, fn) },
      ]
      this.publish({ ...input, operation, target: meta.target, origin: meta.origin, actions, scope: input.scope ?? meta.scope ?? { type: 'action', actionId: meta.operation } })
      throw err
    }
  }

  // ───────────────────────── lifecycle ─────────────────────────

  get(id: string): Signal | undefined {
    return this.state.signals.find((s) => s.id === id)
  }

  acknowledge(id: string): void {
    const s = this.get(id)
    if (!s || s.lifecycle !== 'active') return
    const u = this.update(id, { lifecycle: 'acknowledged' })
    if (u) this.emit('signal.acknowledged', u)
    if (s.persistence === 'until_acknowledged') this.remove(id)
  }

  resolve(id: string): void {
    const s = this.get(id)
    if (!s) return
    const u = this.update(id, { lifecycle: 'resolved' })
    if (u) this.emit('signal.resolved', u)
    this.remove(id)
  }

  dismiss(id: string, reason: 'user' | 'timeout' | 'navigation' | 'programmatic' = 'user'): void {
    const s = this.get(id)
    if (!s) return
    const u = this.update(id, { lifecycle: reason === 'timeout' ? 'resolved' : 'acknowledged' })
    if (u) this.emit('signal.dismissed', u, { action: { id: 'dismiss', type: 'dismiss', label: reason } })
    this.remove(id)
  }

  /** Resolve every active signal matching the predicate (e.g. all field errors of a form). */
  resolveWhere(pred: (s: Signal) => boolean): number {
    const ids = this.state.signals.filter(pred).map((s) => s.id)
    ids.forEach((id) => this.resolve(id))
    return ids.length
  }

  resolveByCode(code: string): number {
    const c = this.registry.canonical(code) ?? code
    return this.resolveWhere((s) => s.code === c)
  }

  resolveScope(scope: SignalScope): number {
    const key = ownerKeyFor(scope)
    return this.resolveWhere((s) => ownerKeyFor(s.scope) === key)
  }

  /** Called by the app on route change: drop transient + action-scoped signals; keep app/system/page-persistent ones. */
  onNavigate(): void {
    for (const s of [...this.state.signals]) {
      const t = s.scope.type
      if (t === 'application' || t === 'system' || t === 'workspace') continue
      if (s.persistence === 'until_resolved' && (t === 'page' || t === 'region')) continue
      this.dismiss(s.id, 'navigation')
    }
  }

  clear(): void {
    for (const s of [...this.state.signals]) this.dismiss(s.id, 'programmatic')
  }

  private remove(id: string) {
    const t = this.timers.get(id)
    if (t) clearTimeout(t)
    this.timers.delete(id)
    this.presentedOnce.delete(id)
    this.createdAt.delete(id)
    this.setSignals(this.state.signals.filter((s) => s.id !== id))
  }

  async selectAction(id: string, actionId: string): Promise<void> {
    const s = this.get(id)
    if (!s) return
    const action = s.actions.find((a) => a.id === actionId)
    if (!action) return
    this.emit('signal.action_selected', s, { action })
    if (action.type === 'retry') this.emit('signal.retry_started', s, { action })
    if (action.type === 'dismiss') return this.dismiss(id)
    if (action.onSelect) {
      // Retry/undo actions own their own follow-up signals; the original is resolved.
      if (action.type === 'retry' || action.type === 'undo') this.resolve(id)
      await action.onSelect(s)
      return
    }
    if (action.destination && typeof window !== 'undefined') {
      if (action.type === 'open') window.open(action.destination, '_blank', 'noopener')
      else window.location.assign(action.destination)
    }
  }

  // ───────────────────────── presentation ownership ─────────────────────────

  claim(key: string, rendererId: string, priority = 0): () => void {
    const list = this.claims.get(key) ?? []
    const claim: Claim = { key, rendererId, priority }
    this.claims.set(key, [...list, claim])
    this.notifyClaims()
    return () => {
      const cur = this.claims.get(key) ?? []
      const next = cur.filter((c) => c !== claim)
      if (next.length) this.claims.set(key, next)
      else this.claims.delete(key)
      this.notifyClaims()
    }
  }

  subscribeClaims = (listener: () => void): (() => void) => {
    this.claimListeners.add(listener)
    return () => this.claimListeners.delete(listener)
  }

  private claimsVersion = 0
  getClaimsVersion = (): number => this.claimsVersion
  private notifyClaims() {
    this.claimsVersion++
    for (const l of this.claimListeners) l()
  }

  /** Which renderer should present this signal: first key in the fallback chain that has a claim, highest priority wins. */
  ownerFor(signal: Signal): { rendererId: string; key: string } | undefined {
    for (const key of fallbackKeys(signal.scope)) {
      const list = this.claims.get(key)
      if (list?.length) {
        const best = [...list].sort((a, b) => b.priority - a.priority)[0]
        return { rendererId: best.rendererId, key }
      }
    }
    return undefined
  }

  presentation(signal: Signal): SignalPresentation {
    return resolveSignal(signal, this.policy)
  }

  /** Renderers call this when a signal becomes visible; emits `signal.presented` once. */
  markPresented(id: string, presentation: SignalPresentation): void {
    if (this.presentedOnce.has(id)) return
    const s = this.get(id)
    if (!s) return
    this.presentedOnce.add(id)
    this.emit('signal.presented', s, { presentation })
  }

  // ───────────────────────── agent view ─────────────────────────

  /** Structured view for agents: no developer payloads, honours visibility.agent. */
  active(): Array<Pick<Signal, 'id' | 'code' | 'kind' | 'severity' | 'message' | 'scope' | 'target' | 'recoverability' | 'resolution' | 'agent' | 'lifecycle'> & { actions: Array<Pick<SignalAction, 'id' | 'type' | 'label' | 'automaticAllowed'>> }> {
    return this.state.signals
      .filter((s) => s.lifecycle === 'active' || s.lifecycle === 'acknowledged')
      .filter((s) => (s.visibility?.agent ?? 'safe') !== 'none')
      .map((s) => ({
        id: s.id,
        code: s.code,
        kind: s.kind,
        severity: s.severity,
        message: s.visibility?.agent === 'redacted' ? (s.agent?.summary ?? s.code) : s.message,
        scope: s.scope,
        target: s.target,
        recoverability: s.recoverability,
        resolution: s.resolution,
        agent: s.agent,
        lifecycle: s.lifecycle,
        actions: s.actions.map(({ id, type, label, automaticAllowed }) => ({ id, type, label, automaticAllowed })),
      }))
  }

  // ───────────────────────── system conditions ─────────────────────────

  readonly system = {
    set: (code: string, opts: Partial<Omit<SignalInput, 'scope' | 'code'>> = {}): Signal =>
      this.publish({ kind: 'warning', ...opts, message: opts.message ?? '', code, scope: { type: 'system' }, persistence: 'until_resolved', dedupKey: `system:${code}` }),
    clear: (code: string): void => {
      this.resolveWhere((s) => s.scope.type === 'system' && s.code === (this.registry.canonical(code) ?? code))
    },
  }
}

function isProblemLike(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false
  if (v instanceof Error) return false
  const o = v as Record<string, unknown>
  return 'code' in o || 'detail' in o || 'type' in o || 'errors' in o || ('message' in o && !('stack' in o))
}

export type { PresentationPolicy }
