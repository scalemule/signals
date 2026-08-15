import { describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import * as React from 'react'
import { createSignals } from '../index'
import { SignalBanner, SignalField, SignalNotifications, SignalProvider, SignalRegion, useFieldSignals } from '../react'

describe('react renderers', () => {
  it('session expiry renders once: banner in shell, or the page-level owner when mounted — never both, never a toast', () => {
    const hub = createSignals()
    function App({ loginMounted }: { loginMounted: boolean }) {
      return (
        <SignalProvider hub={hub}>
          <SignalBanner />
          {loginMounted && <SignalRegion id="login" render={(list) => <div data-testid="login-owner">{list.map((s) => <p key={s.id}>{s.message}</p>)}</div>} />}
          <SignalNotifications />
        </SignalProvider>
      )
    }
    const { rerender } = render(<App loginMounted={false} />)
    act(() => {
      hub.publish({ code: 'auth.session.expired', message: 'Your session has expired. Sign in again to continue.' })
    })
    expect(screen.getAllByText(/session has expired/i)).toHaveLength(1)
    expect(document.querySelector('.sm-signal-banner')).not.toBeNull()
    expect(document.querySelector('.sm-signal-stack')).toBeNull()

    // A page-level owner with higher priority takes it over from the shell banner.
    // (application-scope fallback chain is ['application', 'notification']; a region claims 'application' explicitly here.)
    function LoginOwner() {
      const rid = React.useId()
      React.useLayoutEffect(() => hub.claim('application', rid, 10), [rid])
      return null
    }
    rerender(
      <SignalProvider hub={hub}>
        <SignalBanner />
        <LoginOwner />
        <SignalNotifications />
      </SignalProvider>
    )
    // Banner yields ownership; nothing else renders it → zero visible copies from default renderers.
    expect(document.querySelector('.sm-signal-banner')).toBeNull()
    expect(document.querySelector('.sm-signal-stack')).toBeNull()
  })

  it('field errors render inline with aria association and never as notifications', () => {
    const hub = createSignals()
    function Form() {
      const { ariaProps } = useFieldSignals('email', 'login')
      return (
        <>
          <input aria-label="email" {...ariaProps} />
          <SignalField name="email" formId="login" />
        </>
      )
    }
    render(
      <SignalProvider hub={hub}>
        <Form />
        <SignalNotifications />
      </SignalProvider>
    )
    act(() => {
      hub.error('Enter a valid email address.', { code: 'validation.invalid_input', scope: { type: 'field', field: 'email', formId: 'login' } })
    })
    expect(screen.getByText('Enter a valid email address.')).toBeTruthy()
    expect(document.querySelector('.sm-signal-stack')).toBeNull()
    const input = screen.getByLabelText('email')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe('signal-field-login-email')
  })

  it('unowned action-scope errors fall back to the notification stack with a reference and no auto-dismiss', () => {
    const hub = createSignals()
    render(
      <SignalProvider hub={hub}>
        <SignalNotifications />
      </SignalProvider>
    )
    act(() => {
      hub.error('Could not deploy gateway.', { code: 'ops.deploy.failed', scope: { type: 'action' }, telemetry: { requestId: 'req_abc' } })
    })
    expect(screen.getByText('Could not deploy gateway.')).toBeTruthy()
    expect(screen.getByText(/Ref req_abc/)).toBeTruthy()
    expect(document.querySelector('.sm-signal-stack .sm-signal[data-kind="error"]')).not.toBeNull()
  })
})
