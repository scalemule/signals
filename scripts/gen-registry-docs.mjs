// Generates docs/SIGNAL-CODES.md from src/registry.json (the code catalog).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
const { entries, version } = JSON.parse(readFileSync('src/registry.json', 'utf8'))
const esc = (v) => String(v ?? '').replace(/\|/g, '\\|')
const scope = (s) => (s ? Object.values(s).join(':') : '—')
const lines = [
  '# ScaleMule Signal codes (registry v' + version + ')',
  '',
  'Generated from `@scalemule/signals` `registry.json` — do not edit by hand. Codes are stable identities;',
  'copy may change, codes never do. Legacy aliases (backend `SCREAMING_SNAKE`, SDK `lowercase_snake`) map to the canonical code.',
  '',
  '| Code | Kind | Default scope | Recoverability | Default message | Actions | Agent | Aliases |',
  '|---|---|---|---|---|---|---|---|',
]
for (const e of entries) {
  lines.push(`| \`${e.code}\` | ${e.kind ?? '—'} | ${scope(e.scope)} | ${e.recoverability ?? '—'} | ${esc(e.message)} | ${(e.actions ?? []).map((a) => a.type).join(', ') || '—'} | ${(e.agent?.permissions ?? []).join('/') || '—'} | ${(e.aliases ?? []).map((a) => '`' + a + '`').join(' ') || '—'} |`)
}
lines.push('', `Total: ${entries.length} codes.`, '')
mkdirSync('docs', { recursive: true })
writeFileSync('docs/SIGNAL-CODES.md', lines.join('\n'))
console.log('docs/SIGNAL-CODES.md:', entries.length, 'codes')
