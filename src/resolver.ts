import type { Signal, SignalPresentation, SignalScope, SignalSurface } from './types'

/** Stable key a renderer uses to claim ownership of a scope. */
export function ownerKeyFor(scope: SignalScope): string {
  switch (scope.type) {
    case 'field':
      return `field:${scope.formId ? scope.formId + '/' : ''}${scope.field}`
    case 'control':
      return `control:${scope.controlId}`
    case 'form':
      return `form:${scope.formId}`
    case 'item':
      return `item:${scope.collectionId ? scope.collectionId + '/' : ''}${scope.itemId}`
    case 'region':
      return `region:${scope.regionId}`
    case 'page':
      return `page:${scope.pageId ?? '*'}`
    case 'workspace':
      return `workspace:${scope.workspaceId ?? '*'}`
    case 'application':
      return 'application'
    case 'system':
      return 'system'
    case 'background':
      return 'background'
    case 'action':
      return `action:${scope.actionId ?? '*'}`
  }
}

/** Fallback chain when no renderer owns the preferred key. */
export function fallbackKeys(scope: SignalScope): string[] {
  const chain: string[] = [ownerKeyFor(scope)]
  switch (scope.type) {
    case 'field':
      if (scope.formId) chain.push(`form:${scope.formId}`)
      chain.push('page:*', 'notification')
      break
    case 'control':
    case 'form':
    case 'item':
    case 'region':
      chain.push('page:*', 'notification')
      break
    case 'page':
      chain.push('page:*', 'notification')
      break
    case 'workspace':
    case 'application':
      chain.push('application', 'notification')
      break
    case 'system':
      chain.push('system', 'application', 'notification')
      break
    case 'background':
    case 'action':
      chain.push('notification')
      break
  }
  return [...new Set(chain)]
}

export interface PresentationPolicy {
  /** Override preferred surface per scope type. */
  surfaces?: Partial<Record<SignalScope['type'], SignalSurface>>
  /** Auto-dismiss for transient notifications. Default 5000. */
  transientMs?: number
  /** Show background successes at all? Default true. */
  showBackgroundSuccess?: boolean
}

export const DEFAULT_POLICY: Required<PresentationPolicy> = {
  surfaces: {},
  transientMs: 5000,
  showBackgroundSuccess: true,
}

export function surfaceFor(signal: Signal, policy: PresentationPolicy = {}): SignalSurface {
  const override = policy.surfaces?.[signal.scope.type]
  if (override) return override
  const isProblem = signal.kind === 'error' || signal.kind === 'warning'
  switch (signal.scope.type) {
    case 'field':
      return 'field'
    case 'control':
      return 'control'
    case 'form':
      return 'form-summary'
    case 'item':
      return 'item'
    case 'region':
      return 'region'
    case 'page':
      return isProblem ? 'page' : 'callout'
    case 'workspace':
    case 'application':
      return 'banner'
    case 'system':
      return 'status-bar'
    case 'background':
      if (signal.kind === 'progress') return 'progress'
      if (signal.kind === 'success' && policy.showBackgroundSuccess === false) return 'silent'
      return 'notification'
    case 'action':
      if (signal.kind === 'confirmation') return 'dialog'
      if (signal.kind === 'progress') return 'progress'
      return 'notification'
  }
}

export function resolveSignal(signal: Signal, policy: PresentationPolicy = {}): SignalPresentation {
  const surface = surfaceFor(signal, policy)
  const isProblem = signal.kind === 'error' || signal.kind === 'warning'
  const live =
    signal.interruptiveness === 'interruptive' ? 'assertive' : signal.interruptiveness === 'none' ? 'off' : 'polite'
  const role = signal.interruptiveness === 'interruptive' ? 'alert' : live === 'off' ? 'none' : 'status'
  const transientMs = policy.transientMs ?? DEFAULT_POLICY.transientMs
  const autoDismissMs =
    signal.persistence === 'transient' && !isProblem && surface !== 'dialog' && surface !== 'progress' ? transientMs : undefined
  return {
    surface,
    ownerKey: ownerKeyFor(signal.scope),
    live,
    role,
    autoDismissMs,
    focus: surface === 'field' && signal.kind === 'error',
  }
}
