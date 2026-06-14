// eslint-config-next 16 ships native flat configs (arrays) at its subpath
// exports, so we spread them directly. The old FlatCompat shim broke on v16
// (its config now has a circular structure that FlatCompat's validator can't
// JSON-stringify), and `next lint` was removed in Next 16 — the lint script
// now invokes `eslint .` against this flat config.
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      '.legacy/**',
      'src/payload-types.ts',
      'src/app/(payload)/admin/importMap.js',
    ],
  },
]

export default eslintConfig
