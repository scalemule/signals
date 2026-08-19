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

/**
 * Platform-wide defaults shipped with the SDK — the data lives in `registry.json`
 * (also exported as `@scalemule/signals/registry.json` for non-JS consumers and for
 * generating the code catalog). Apps extend via `signals.registry.register(...)`.
 */
import registryData from './registry.json'

export const DEFAULT_REGISTRY: RegistryEntry[] = (registryData as { entries: RegistryEntry[] }).entries
