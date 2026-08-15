import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    treeshake: true,
  },
  {
    // React entry: keep the core external so both entries share ONE hub instance
    // (a bundled copy would create a second `signals` singleton).
    entry: { 'react/index': 'src/react/index.tsx' },
    format: ['cjs', 'esm'],
    dts: true,
    sourcemap: true,
    treeshake: false,
    external: ['react', 'react-dom', 'react/jsx-runtime', '../index'],
  },
])
