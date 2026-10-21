# @scalemule/signals

**Contextual application feedback for humans, agents, and systems.**

Applications emit *meaning* — what happened, where, how serious, what can be done — and Signals
decides how it is presented to a human, exposed to an agent, and recorded operationally. A toast
becomes one renderer among many, not the API.

> Spec: `docs/ADR-2026-08-15-scalemule-signals.md` in the ScaleMule meta-repo.

```bash
npm install @scalemule/signals
```

## 60-second tour

```tsx
// app root (once)
import '@scalemule/signals/styles.css'
import { SignalProvider, SignalRoot } from '@scalemule/signals/react'

<SignalProvider>
  <SignalRoot />          {/* status bar (system) + banner (application) + notifications (action/background) */}
  {children}
</SignalProvider>
```

```ts
import { signals } from '@scalemule/signals'

// Field error → inline under the field (needs <SignalField name="email" formId="customer" /> mounted)
signals.error('Enter a valid email address.', { code: 'customer.email.invalid', scope: { type: 'field', field: 'email', formId: 'customer' } })

// Region failure → message inside <SignalRegion id="customer-details">
signals.error("We couldn't save these changes.", { code: 'customer.update.failed', scope: { type: 'region', regionId: 'customer-details' }, recoverability: 'retry' })

// Success → transient notification
signals.success('Customer saved.', { code: 'customer.saved', scope: { type: 'background' } })

// Session expiry → persistent application banner until resolved (registry default)
signals.publish({ code: 'auth.session.expired', message: '' })
signals.resolveByCode('auth.session.expired')   // after sign-in

// Wrap an operation: failure → error with Retry, success resolves earlier failures
await signals.run({ operation: 'customer.update', scope: { type: 'form', formId: 'customer' } }, () => api.put('/customers/1', body))

// From any thrown error / API body (ScaleMule envelope, RFC 9457, SDK errors, fetch failures)
try { await api.post('/deploy') } catch (e) { signals.report(e, { scope: { type: 'region', regionId: 'deploys' } }) }
```

## Model

A `Signal` has `code`, `kind` (error | warning | info | success | progress | confirmation),
`severity`, `scope` (field | control | form | item | region | page | workspace | application |
system | background | action), `target`, `operation`, `persistence`, `interruptiveness`,
`recoverability`, `actions[]`, `telemetry` (`requestId`, `traceId`), `visibility`, `agent`,
`developer`. Callers never choose a surface; the **resolver** does:

| scope | surface |
|---|---|
| field | inline under the field (`SignalField`), `aria-invalid` + `aria-describedby` |
| form | form summary (`SignalFormSummary`) |
| item / region | inside the owner (`SignalRegion`) |
| page | page error state (`SignalPageState`) |
| application / workspace | persistent banner (`SignalBanner`) |
| system | status bar (`SignalStatusBar`) |
| background / action | notification stack (`SignalNotifications`) — successes auto-dismiss, errors never do |

**Ownership.** Renderers *claim* keys (`region:billing`, `field:customer/email`, `application`,
`notification`). A signal renders in the highest-priority claimant of the first key in its
fallback chain (`field → form → page → notification`). One message, one surface, once.

**Dedup.** `code + operation + target + scope` collapses repeats into one visible signal.

**Lifecycle.** `created → active → acknowledged → resolved | superseded`; every transition
emits an event to adapters (`consoleAdapter`, `sentryAdapter`, `httpAdapter`, or your own).
`toTelemetryAttributes(event)` gives OTel-style flat attributes (`signal.code`, `signal.scope`,
`signal.presentation`, `signal.duration_ms`, `request.id`, `trace.id`).

**Agents.** `signals.active()` returns a structured, visibility-filtered view with
`resolution`, `recoverability` and typed `actions` — no DOM scraping.

**Registry.** `signals.registry.register({ code, kind, scope, recoverability, message, actions, aliases })`
sets defaults per code so good UX is the default; `aliases` accept legacy identifiers
(e.g. `SESSION_EXPIRED`) during migration. The platform defaults live in `registry.json`
(`import reg from '@scalemule/signals/registry.json'` — usable from any language) and the
generated catalog is `docs/SIGNAL-CODES.md`.

## Forms: inline validation by default

Use `SignalForm` and `SignalInput` for customer forms. Do not use plain `<form>`
with native validation bubbles, `reportValidity()`, or browser `alert()` for errors.
Importing an SDK does not change arbitrary HTML forms: use these components and
enable the build check below. Server validation and authorization remain required.

```tsx
import { SignalForm, SignalInput } from '@scalemule/signals/react'
import '@scalemule/signals/styles.css'

<SignalForm id="create-workspace" onSubmit={createWorkspace}
  messages={{ name: { required: 'Give your workspace a name.' } }}>
  <label htmlFor="workspace-name">Workspace name</label>
  <SignalInput id="workspace-name" name="name" required maxLength={120} />
  <button>Create workspace</button>
</SignalForm>
```

`SignalForm` defaults to POST and disables controls until hydration, preventing
accidental native submissions (including passwords in GET URLs) while scripts load.
It always renders `noValidate`, checks named controls before calling
`onSubmit`, publishes field Signals, and focuses the first invalid field. It checks
required values (including blank text), email/URL format, length, pattern and range.
`SignalInput` renders the inline error, sets `aria-invalid`/`aria-describedby`, and
preserves existing hint associations. Editing resolves that field's errors; form
reset/unmount clears client validation. Values are never included in Signals.

For selects/textareas, pair the named control with `useFieldSignals(name, formId)`
and `SignalField`; `SignalForm` validates them too. Use `validate={(data) => ({
fieldName: 'Helpful correction' })}` for additional synchronous business rules.
Use `hub.report(error, { scope: { type: 'form', formId } })` with
`SignalFormSummary` for server failures. Every field must have an inline renderer.

Add TypeScript to your application's devDependencies and make the guard part of
its build/CI, so new plain forms cannot ship:

```json
{
  "scripts": {
    "check:forms": "scalemule-check-forms src",
    "build": "npm run check:forms && next build"
  }
}
```

The guard parses TSX/JSX and rejects raw forms and constrained raw inputs. It does
not alter the DOM or disable validation on unrelated forms. It is opt-in per app;
existing SDK consumers must migrate their forms and enable the check.

## React API

`SignalProvider`, `SignalRoot`, `SignalBanner`, `SignalStatusBar`, `SignalNotifications`,
`SignalRegion`, `SignalField`, `SignalFormSummary`, `SignalPageState`, `SignalBoundary`,
`SignalCard`; hooks `useSignals`, `useOwnedSignals`, `useClaim`, `useFieldSignals`,
`useSignalNavigation`, `useSignalHub`.

Styling: import `@scalemule/signals/styles.css` and override the `--sm-signal-*` variables, or
render your own components from `useOwnedSignals` (the protocol does not depend on the default UI).

## Status

`0.0.x` — pre-stable, patch-only releases per ScaleMule SDK policy. Vue/Svelte/mobile bindings,
TanStack Query / Next.js adapters, the logger sink, and the Signal Inspector are on the roadmap
in the ADR.
