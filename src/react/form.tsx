'use client'

import * as React from 'react'
import { useSignalHub, useFieldSignals, SignalField } from './index'

type FormConstraint = 'required' | 'type' | 'minLength' | 'maxLength' | 'pattern' | 'range' | 'invalid'
type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
const FormContext = React.createContext<string | undefined>(undefined)
const validationCode = 'form.validation.invalid'

export interface SignalFormProps extends Omit<React.FormHTMLAttributes<HTMLFormElement>, 'id' | 'noValidate'> {
  /** Unique on this page; isolates errors from other forms. */
  id: string
  messages?: Record<string, Partial<Record<FormConstraint, string>>>
  /** Additional synchronous business rules, keyed by input name. Never include values in messages. */
  validate?: (data: FormData) => Partial<Record<string, string>>
}

function constraintError(field: FormControl): [FormConstraint, string] | undefined {
  const { validity, value } = field
  const text = !(field instanceof HTMLInputElement) || !['password', 'file', 'checkbox', 'radio'].includes(field.type)
  if (validity.valueMissing || (field.required && text && !value.trim())) return ['required', 'This field is required.']
  if (validity.typeMismatch) return ['type', field instanceof HTMLInputElement && field.type === 'email' ? 'Enter a valid email address.' : 'Enter a valid value.']
  // Browsers skip length constraints on programmatically assigned/controlled values.
  if ('minLength' in field && value && field.minLength > 0 && value.length < field.minLength) return ['minLength', `Use at least ${field.minLength} characters.`]
  if ('maxLength' in field && field.maxLength >= 0 && value.length > field.maxLength) return ['maxLength', `Use ${field.maxLength} characters or fewer.`]
  if (validity.patternMismatch) return ['pattern', 'Use the requested format.']
  if (validity.rangeOverflow || validity.rangeUnderflow || validity.stepMismatch) return ['range', 'Enter a value in the allowed range.']
  if (!validity.valid) return ['invalid', 'Check this value and try again.']
}

/** Replaces browser validation bubbles with field Signals; validates before calling onSubmit. */
export function SignalForm({ id, messages, validate, onSubmit, onChange, onReset, onInvalid, children, ...props }: SignalFormProps) {
  const hub = useSignalHub()
  const clear = React.useCallback(() => {
    hub.resolveWhere((s) => s.code === validationCode && s.scope.type === 'field' && s.scope.formId === id)
  }, [hub, id])
  React.useEffect(() => clear, [clear])
  return (
    <FormContext.Provider value={id}>
      <form
        {...props}
        id={id}
        noValidate
        onInvalid={(event) => { event.preventDefault(); onInvalid?.(event) }}
        onChange={(event) => {
          const field = event.target
          if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) {
            if (field.name) hub.resolveScope({ type: 'field', formId: id, field: field.name })
          }
          onChange?.(event)
        }}
        onReset={(event) => { clear(); onReset?.(event) }}
        onSubmit={(event) => {
          clear()
          const form = event.currentTarget
          const fields = Array.from(form.elements).filter((field): field is FormControl =>
            (field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) && field.willValidate && Boolean(field.name))
          const errors: Record<string, string> = {}
          for (const field of fields) {
            const error = constraintError(field)
            if (error && !errors[field.name]) errors[field.name] = messages?.[field.name]?.[error[0]] ?? error[1]
          }
          for (const [field, message] of Object.entries(validate?.(new FormData(form)) ?? {})) {
            if (message) errors[field] = message
          }
          for (const [field, message] of Object.entries(errors)) {
            hub.error(message, { code: validationCode, scope: { type: 'field', formId: id, field }, recoverability: 'user_action', source: 'validation' })
          }
          if (Object.keys(errors).length) {
            event.preventDefault()
            fields.find((field) => errors[field.name])?.focus()
            return
          }
          onSubmit?.(event)
        }}
      >{children}</form>
    </FormContext.Provider>
  )
}

export interface SignalInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  name: string
  errorClassName?: string
}

/** Named input + inline SignalField, with accessible error association and hint preservation. */
export const SignalInput = React.forwardRef<HTMLInputElement, SignalInputProps>(function SignalInput({ name, errorClassName, ...props }, ref) {
  const formId = React.useContext(FormContext)
  if (!formId) throw new Error('SignalInput must be inside a SignalForm with a unique id.')
  const { ariaProps } = useFieldSignals(name, formId)
  const describedBy = [props['aria-describedby'], ariaProps['aria-describedby']].filter(Boolean).join(' ') || undefined
  return <>
    <input {...props} ref={ref} name={name} aria-invalid={ariaProps['aria-invalid'] ?? props['aria-invalid']} aria-describedby={describedBy} />
    <SignalField name={name} formId={formId} className={errorClassName} />
  </>
})

