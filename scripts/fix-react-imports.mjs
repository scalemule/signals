// The react entry imports the core via '../index' (kept external so both entries share
// one hub instance). Node ESM needs explicit extensions; add them per format.
import { readFileSync, writeFileSync } from 'node:fs'
for (const [file, ext] of [['dist/react/index.mjs', '.mjs'], ['dist/react/index.js', '.js']]) {
  const src = readFileSync(file, 'utf8')
  writeFileSync(file, src.replaceAll("'../index'", `'../index${ext}'`).replaceAll('"../index"', `"../index${ext}"`))
}
