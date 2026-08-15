export * from './types'
export { SignalRegistry, DEFAULT_REGISTRY, renderTemplate } from './registry'
export { resolveSignal, surfaceFor, ownerKeyFor, fallbackKeys, DEFAULT_POLICY } from './resolver'
export type { PresentationPolicy } from './resolver'
export { fromProblem, fromProblemWithChildren, fromError, extractProblem, statusToCode, codeFromTypeUri } from './normalize'
export type { ProblemLike, NormalizeContext } from './normalize'
export { SignalHub } from './hub'
export type { SignalHubOptions, SignalState, Claim, RunMeta } from './hub'
export { toTelemetryAttributes, consoleAdapter, sentryAdapter, httpAdapter } from './adapters'

import { SignalHub, type SignalHubOptions } from './hub'

/** Create an isolated hub (tests, micro-frontends, per-tenant embeds). */
export function createSignals(opts: SignalHubOptions = {}): SignalHub {
  return new SignalHub(opts)
}

/**
 * Process-wide default hub. Most apps use this directly:
 *   import { signals } from '@scalemule/signals'
 *   signals.error('Could not save', { code: 'customer.update.failed', scope: { type: 'form', formId: 'customer' } })
 */
export const signals: SignalHub = new SignalHub()
