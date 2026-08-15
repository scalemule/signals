import { describe, expect, it, vi } from 'vitest'
import { createSignals, fromError, fromProblem, extractProblem, resolveSignal, ownerKeyFor, fallbackKeys, codeFromTypeUri, toTelemetryAttributes } from '../index'
import type { SignalEvent } from '../types'

describe('normalize', () => {
  it('extracts the ScaleMule envelope and lifts meta.request_id', () => {
    const p = extractProblem({ success: false, error: { code: 'SESSION_EXPIRED', message: 'Session expired', field: null }, meta: { timestamp: 't', request_id: 'req_0191' } })!
    expect(p.code).toBe('SESSION_EXPIRED')
    expect(p.request_id).toBe('req_0191')
    const input = fromProblem(p, { status: 401 })
    expect(input.telemetry?.requestId).toBe('req_0191')
    expect(input.message).toBe('Session expired')
    expect(input.kind).toBe('warning')
  })

  it('handles gateway bare {error:"string"} and RFC 9457 bodies', () => {
    expect(fromProblem(extractProblem({ error: 'placement unavailable' })!, { status: 503 }).code).toBe('service.unavailable')
    const rfc = fromProblem({ type: 'https://errors.scalemule.com/customer/email-invalid', title: 'Invalid customer email', status: 422, detail: 'Enter a valid email address.', instance: '/requests/req_123', field: 'email' })
    expect(rfc.code).toBe('customer.email_invalid')
    expect(rfc.scope).toEqual({ type: 'field', field: 'email' })
    expect(rfc.telemetry?.requestId).toBe('req_123')
    expect(rfc.recoverability).toBe('user_action')
  })

  it('codeFromTypeUri', () => {
    expect(codeFromTypeUri('about:blank')).toBeUndefined()
    expect(codeFromTypeUri('https://errors.scalemule.com/auth/session-expired')).toBe('auth.session_expired')
    expect(codeFromTypeUri('/errors/billing/card-declined')).toBe('billing.card_declined')
  })

  it('fromError: admin ApiError {status,data,url}, network TypeError, plain Error', () => {
    const api = Object.assign(new Error('Request failed with status 409'), { name: 'ApiError', status: 409, url: '/v1/x', data: { success: false, error: { code: 'ALREADY_EXISTS', message: 'Slug already used' }, meta: { request_id: 'req_9' } } })
    const a = fromError(api)
    expect(a.code).toBe('ALREADY_EXISTS')
    expect(a.message).toBe('Slug already used')
    expect(a.telemetry?.requestId).toBe('req_9')
    expect(a.developer?.status).toBe(409)

    const net = fromError(new TypeError('Failed to fetch'))
    expect(net.code).toBe('network.request_failed')
    expect(net.source).toBe('network')

    const plain = fromError(new Error('boom'))
    expect(plain.code).toBe('client.error')
    expect(plain.message).toBe('boom')

    expect(fromError('nope').message).toBe('nope')
  })
})

describe('resolver', () => {
  it('routes by scope', () => {
    const hub = createSignals()
    const field = hub.error('Bad email', { code: 'x', scope: { type: 'field', field: 'email', formId: 'f' } })
    expect(resolveSignal(field).surface).toBe('field')
    expect(resolveSignal(field).focus).toBe(true)
    expect(ownerKeyFor(field.scope)).toBe('field:f/email')
    expect(fallbackKeys(field.scope)).toEqual(['field:f/email', 'form:f', 'page:*', 'notification'])
    const app = hub.warning('expired', { code: 'auth.session.expired' })
    expect(resolveSignal(app).surface).toBe('banner')
    const bg = hub.success('Saved', { scope: { type: 'background' } })
    expect(resolveSignal(bg).surface).toBe('notification')
    expect(resolveSignal(bg).autoDismissMs).toBe(5000)
    const err = hub.error('x', { scope: { type: 'action' } })
    expect(resolveSignal(err).autoDismissMs).toBeUndefined() // errors never auto-dismiss
    expect(resolveSignal(err).surface).toBe('notification')
  })
})

describe('hub', () => {
  it('applies registry defaults and aliases', () => {
    const hub = createSignals()
    const s = hub.publish({ code: 'SESSION_EXPIRED', message: '' })
    expect(s.code).toBe('auth.session.expired')
    expect(s.scope).toEqual({ type: 'application' })
    expect(s.persistence).toBe('until_resolved')
    expect(s.actions[0].type).toBe('authenticate')
    expect(s.message).toMatch(/Sign in again/)
  })

  it('dedupes by code+operation+target+scope and keeps one visible', () => {
    const events: SignalEvent[] = []
    const hub = createSignals({ adapters: [{ name: 't', onEvent: (e) => events.push(e) }] })
    const a = hub.error('first', { code: 'customer.update.failed', operation: { name: 'customer.update' }, target: { type: 'customer', id: '1' }, scope: { type: 'region', regionId: 'r' } })
    const b = hub.error('second', { code: 'customer.update.failed', operation: { name: 'customer.update' }, target: { type: 'customer', id: '1' }, scope: { type: 'region', regionId: 'r' } })
    expect(b.id).toBe(a.id)
    expect(hub.getState().signals).toHaveLength(1)
    expect(hub.getState().signals[0].message).toBe('second')
    expect(events.filter((e) => e.name === 'signal.created')).toHaveLength(1)
  })

  it('lifecycle: resolve/dismiss emit and remove; navigation keeps app/system', () => {
    const events: SignalEvent[] = []
    const hub = createSignals({ adapters: [{ name: 't', onEvent: (e) => events.push(e) }] })
    const app = hub.publish({ code: 'auth.session.expired', message: 'x' })
    const act = hub.error('failed', { code: 'a.b', scope: { type: 'action' } })
    const sys = hub.system.set('network.offline')
    hub.onNavigate()
    const ids = hub.getState().signals.map((s) => s.id)
    expect(ids).toContain(app.id)
    expect(ids).toContain(sys.id)
    expect(ids).not.toContain(act.id)
    hub.resolveByCode('auth.session.expired')
    expect(hub.get(app.id)).toBeUndefined()
    expect(events.some((e) => e.name === 'signal.resolved' && e.signal.id === app.id)).toBe(true)
    hub.system.clear('network.offline')
    expect(hub.getState().signals).toHaveLength(0)
  })

  it('transient signals auto-dismiss', () => {
    vi.useFakeTimers()
    const hub = createSignals()
    hub.success('Saved', { code: 'x.saved', scope: { type: 'action' } })
    expect(hub.getState().signals).toHaveLength(1)
    vi.advanceTimersByTime(5001)
    expect(hub.getState().signals).toHaveLength(0)
    vi.useRealTimers()
  })

  it('ownership: highest-priority claim on first key in fallback chain wins', () => {
    const hub = createSignals()
    const s = hub.error('x', { code: 'c', scope: { type: 'region', regionId: 'billing' } })
    hub.claim('notification', 'toaster', 0)
    expect(hub.ownerFor(s)?.rendererId).toBe('toaster')
    const release = hub.claim('region:billing', 'region', 10)
    expect(hub.ownerFor(s)?.rendererId).toBe('region')
    hub.claim('region:billing', 'override', 20)
    expect(hub.ownerFor(s)?.rendererId).toBe('override')
    release()
    expect(hub.ownerFor(s)?.rendererId).toBe('override')
  })

  it('run(): failure publishes with retry action; success resolves prior failures', async () => {
    const hub = createSignals()
    let fail = true
    const op = () => hub.run({ operation: 'save', scope: { type: 'form', formId: 'f' } }, async () => { if (fail) throw new Error('nope'); return 42 })
    await expect(op()).rejects.toThrow('nope')
    const failed = hub.getState().signals[0]
    expect(failed.actions.some((a) => a.type === 'retry')).toBe(true)
    fail = false
    await expect(op()).resolves.toBe(42)
    expect(hub.getState().signals).toHaveLength(0)
  })

  it('report(): multi-field validation creates children with field scope', () => {
    const hub = createSignals()
    hub.report({ code: 'validation.invalid_input', message: 'Fix fields', errors: [{ field: 'email', message: 'Invalid' }, { field: 'name', message: 'Required' }] })
    const list = hub.getState().signals
    expect(list).toHaveLength(3)
    expect(list.filter((s) => s.scope.type === 'field')).toHaveLength(2)
  })

  it('active(): agent view hides developer payloads and honours visibility', () => {
    const hub = createSignals()
    hub.error('Card declined 4242', { code: 'billing.card.declined', visibility: { agent: 'redacted' }, agent: { summary: 'Payment failed' }, developer: { details: 'raw' } })
    hub.error('hidden', { code: 'x', visibility: { agent: 'none' } })
    const a = hub.active()
    expect(a).toHaveLength(1)
    expect(a[0].message).toBe('Payment failed')
    expect((a[0] as any).developer).toBeUndefined()
  })

  it('telemetry attributes are flat and redact when asked', () => {
    const hub = createSignals()
    const s = hub.error('secret msg', { code: 'x.y', visibility: { telemetry: 'redacted' }, telemetry: { requestId: 'req_1' } })
    const attrs = toTelemetryAttributes({ name: 'signal.created', signal: s, at: 'now' })
    expect(attrs['signal.code']).toBe('x.y')
    expect(attrs['request.id']).toBe('req_1')
    expect(attrs['signal.message']).toBeUndefined()
  })
})
