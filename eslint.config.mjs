import { defineConfig, globalIgnores } from 'eslint/config'
import next from 'eslint-config-next'
import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescript from 'eslint-config-next/typescript'

export default defineConfig([
  ...next,
  ...coreWebVitals,
  ...typescript,
  globalIgnores(['public/**', '.next/**', 'out/**', 'node_modules/**', 'next-env.d.ts', 'supabase/functions/admin-api/index.ts']),
  {
    rules: {
      'react/no-danger': 'error',
      'no-restricted-syntax': ['error', { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'dangerouslySetInnerHTML is not allowed (XSS).' }],
    },
  },
])
