// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

describe('consumer form build guard', () => {
  it('rejects raw JSX forms even with noValidate and accepts SignalForm, including multiline attributes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scalemule-forms-'))
    try {
      const file = join(dir, 'page.tsx')
      writeFileSync(file, 'export const Example = () => <form\n noValidate><input required /></form>')
      const bad = spawnSync(process.execPath, [resolve('scripts/check-forms.mjs'), dir], { encoding: 'utf8' })
      expect(bad.status).toBe(1)
      expect(bad.stderr).toContain('page.tsx:1:')
      expect(bad.stderr).toContain('Use SignalForm')
      expect(bad.stderr).toContain('Use SignalInput')
      writeFileSync(file, 'export const Example = () => <SignalForm id="team"><SignalInput name="name" required /></SignalForm>')
      const good = spawnSync(process.execPath, [resolve('scripts/check-forms.mjs'), dir], { encoding: 'utf8' })
      expect(good.status).toBe(0)
      expect(good.stdout).toContain('passed')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
