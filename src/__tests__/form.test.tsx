import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSignals } from '../index'
import { SignalForm, SignalInput, SignalNotifications, SignalProvider } from '../react'

afterEach(cleanup)

describe('SignalForm', () => {
  it('blocks an empty workspace, focuses the field, and renders one accessible inline error without native validation', () => {
    const submit = vi.fn((e: React.FormEvent) => e.preventDefault())
    const invalid = vi.fn()
    render(<SignalProvider hub={createSignals()}><SignalForm id="workspace" onSubmit={submit}
      messages={{ name: { required: 'Give your workspace a name.' } }}>
      <label htmlFor="name">Workspace name</label>
      <SignalInput id="name" name="name" required aria-describedby="hint" onInvalid={invalid} />
      <p id="hint">Choose a name your team will recognize.</p>
      <button>Create workspace</button>
    </SignalForm><SignalNotifications /></SignalProvider>)
    const input = screen.getByLabelText('Workspace name')
    const form = input.closest('form')!
    expect(form.noValidate).toBe(true)
    fireEvent.click(screen.getByText('Create workspace'))
    expect(submit).not.toHaveBeenCalled()
    expect(invalid).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(input)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe('hint signal-field-workspace-name')
    expect(screen.getAllByText('Give your workspace a name.')).toHaveLength(1)
    expect(document.querySelector('.sm-signal-stack')).toBeNull()
    fireEvent.change(input, { target: { value: 'Bay Area News' } })
    expect(screen.queryByText('Give your workspace a name.')).toBeNull()
    expect(input.getAttribute('aria-describedby')).toBe('hint')
    fireEvent.click(screen.getByText('Create workspace'))
    expect(submit).toHaveBeenCalledOnce()
  })

  it('validates whitespace, controlled password lengths and malformed email, while preserving entered values', () => {
    const submit = vi.fn()
    render(<SignalProvider hub={createSignals()}><SignalForm id="signup" onSubmit={submit}>
      <SignalInput name="name" aria-label="Name" required defaultValue="   " />
      <SignalInput name="email" aria-label="Email" type="email" required defaultValue="wrong" />
      <SignalInput name="password" aria-label="Password" type="password" minLength={8} required defaultValue="short" />
      <button>Sign up</button>
    </SignalForm></SignalProvider>)
    fireEvent.click(screen.getByText('Sign up'))
    expect(submit).not.toHaveBeenCalled()
    expect(screen.getByText('This field is required.')).toBeTruthy()
    expect(screen.getByText('Enter a valid email address.')).toBeTruthy()
    expect(screen.getByText('Use at least 8 characters.')).toBeTruthy()
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('wrong')
  })

  it('isolates same-named fields between forms and clears validation on unmount', () => {
    const hub = createSignals()
    function Forms({ first = true }) {
      return <SignalProvider hub={hub}>
        {first && <SignalForm id="first"><SignalInput name="name" aria-label="First" required /><button>First submit</button></SignalForm>}
        <SignalForm id="second"><SignalInput name="name" aria-label="Second" required /><button>Second submit</button></SignalForm>
      </SignalProvider>
    }
    const { rerender } = render(<Forms />)
    fireEvent.click(screen.getByText('First submit'))
    expect(screen.getByLabelText('Second').hasAttribute('aria-invalid')).toBe(false)
    fireEvent.change(screen.getByLabelText('Second'), { target: { value: 'Team' } })
    expect(screen.getByText('This field is required.')).toBeTruthy()
    rerender(<Forms first={false} />)
    expect(hub.active()).toHaveLength(0)
  })

  it('allows international names and custom business rules while skipping disabled controls', () => {
    const submit = vi.fn((e: React.FormEvent) => e.preventDefault())
    render(<SignalProvider hub={createSignals()}><SignalForm id="team" onSubmit={submit}
      validate={(data) => data.get('name') === 'taken' ? { name: 'Choose another name.' } : {}}>
      <SignalInput name="name" aria-label="Name" required defaultValue="taken" />
      <SignalInput name="disabled" required disabled />
      <button>Save</button>
    </SignalForm></SignalProvider>)
    fireEvent.click(screen.getByText('Save'))
    expect(screen.getByText('Choose another name.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Редакция 東京 🌱' } })
    fireEvent.click(screen.getByText('Save'))
    expect(submit).toHaveBeenCalledOnce()
  })
})
