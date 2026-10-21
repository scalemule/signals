#!/usr/bin/env node
// Consumer build guard. TypeScript is resolved from the application, not bundled in the SDK.
import { createRequire } from 'node:module'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve, join, extname } from 'node:path'
const require = createRequire(resolve('package.json'))
let ts
try { ts = require('typescript') } catch {
  console.error('scalemule-check-forms requires TypeScript in your application devDependencies.')
  process.exit(1)
}
const roots = process.argv.slice(2)
if (!roots.length) {
  console.error('Usage: scalemule-check-forms src [other-source-directory]')
  process.exit(1)
}
let errors = 0
function inspect(path) {
  if (statSync(path).isDirectory()) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (!entry.isSymbolicLink() && !['node_modules', '.next', '.git', 'dist'].includes(entry.name)) inspect(join(path, entry.name))
    }
    return
  }
  if (!['.tsx', '.jsx'].includes(extname(path))) return
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source)
      const constrained = tag === 'input' && node.attributes.properties.some((attr) =>
        ts.isJsxAttribute(attr) && ['required', 'pattern', 'minLength', 'maxLength'].includes(attr.name.getText(source)))
      if (tag === 'form' || constrained) {
        const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source))
        console.error(`${path}:${line + 1}:${character + 1}: Use ${tag === 'form' ? 'SignalForm' : 'SignalInput'} from @scalemule/signals/react for inline validation. Native browser validation popups are not allowed.`)
        errors++
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}
for (const root of roots) inspect(resolve(root))
if (errors) process.exit(1)
console.log('ScaleMule form check passed.')
