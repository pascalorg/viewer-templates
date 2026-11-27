/* Ported from home-assistant/frontend (Apache-2.0):
   - src/dialogs/enter-code/dialog-enter-code.ts */

import { mdiBackspaceOutline } from '@mdi/js'
import { type FormEvent, useEffect, useState } from 'react'
import { MdiIcon } from './MdiIcon'

export type CodeEntryProps = {
  codeFormat: 'number' | 'text'
  codePattern?: string
  title: string
  submitText: string
  cancelText: string
  codeLabel: string
  clearLabel: string
  invalidCodeText: string
  onSubmit: (code: string) => void
  onCancel: () => void
}

const KEYPAD_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

/**
 * Inline code entry panel for protected lock and alarm actions.
 * The entered code lives only in ephemeral component state and is never persisted or logged.
 */
export function CodeEntry({
  codeFormat,
  codePattern,
  title,
  submitText,
  cancelText,
  codeLabel,
  clearLabel,
  invalidCodeText,
  onSubmit,
  onCancel,
}: CodeEntryProps) {
  const [code, setCode] = useState('')
  const [invalid, setInvalid] = useState(false)

  useEffect(() => () => setCode(''), [])

  const validate = (candidate: string): boolean => {
    if (!codePattern) return true
    try {
      return new RegExp(`^(?:${codePattern})$`).test(candidate)
    } catch {
      return true
    }
  }

  const handleSubmit = (ev?: FormEvent) => {
    ev?.preventDefault()
    if (!validate(code)) {
      setInvalid(true)
      return
    }
    const submitted = code
    setCode('')
    setInvalid(false)
    onSubmit(submitted)
  }

  const handleCancel = () => {
    setCode('')
    setInvalid(false)
    onCancel()
  }

  const appendDigit = (digit: string) => {
    setInvalid(false)
    setCode((prev) => prev + digit)
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="grid w-full gap-3 rounded-2xl border border-border/70 bg-foreground/[0.04] p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <button
          type="button"
          onClick={handleCancel}
          className="rounded-full px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
        >
          {cancelText}
        </button>
      </div>

      <input
        type="password"
        autoFocus
        autoComplete="one-time-code"
        inputMode={codeFormat === 'number' ? 'numeric' : 'text'}
        aria-label={codeLabel}
        placeholder={codeLabel}
        value={code}
        onChange={(ev) => {
          setInvalid(false)
          setCode(ev.target.value)
        }}
        className="h-10 w-full rounded-xl border border-border bg-background/80 px-3 text-center font-mono text-base tracking-widest text-foreground outline-none focus:border-[#009ac7]"
      />

      {invalid && (
        <p role="alert" className="m-0 text-center text-xs text-[#db4437]">
          {invalidCodeText}
        </p>
      )}

      {codeFormat === 'number' && (
        <div className="grid grid-cols-3 gap-2">
          {KEYPAD_DIGITS.map((digit) => (
            <button
              key={digit}
              type="button"
              onClick={() => appendDigit(digit)}
              className="h-11 rounded-full bg-foreground/[0.08] text-base font-medium text-foreground transition-colors hover:bg-foreground/[0.15] active:scale-95"
            >
              {digit}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setCode('')
              setInvalid(false)
            }}
            className="h-11 rounded-full bg-foreground/[0.05] text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.12] hover:text-foreground"
          >
            {clearLabel}
          </button>
          <button
            type="button"
            onClick={() => appendDigit('0')}
            className="h-11 rounded-full bg-foreground/[0.08] text-base font-medium text-foreground transition-colors hover:bg-foreground/[0.15] active:scale-95"
          >
            0
          </button>
          <button
            type="button"
            aria-label="Backspace"
            onClick={() => {
              setInvalid(false)
              setCode((prev) => prev.slice(0, -1))
            }}
            className="grid h-11 place-items-center rounded-full bg-foreground/[0.05] text-muted-foreground transition-colors hover:bg-foreground/[0.12] hover:text-foreground"
          >
            <MdiIcon path={mdiBackspaceOutline} size={20} />
          </button>
        </div>
      )}

      <button
        type="submit"
        className="h-10 w-full rounded-full bg-[#009ac7] px-4 text-sm font-medium text-white transition-opacity hover:opacity-90"
      >
        {submitText}
      </button>
    </form>
  )
}
