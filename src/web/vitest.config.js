import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    // Node by default (the integration suites talk to a real local
    // Supabase stack, no DOM needed) -- component tests opt into a
    // DOM per-file via a `// @vitest-environment jsdom` docblock at
    // the top of the file instead of flipping this globally.
    environment: 'node',
    setupFiles: ['./tests/component/setup.js'],
    include: ['tests/**/*.test.{js,jsx}'],
    testTimeout: 15000,
    hookTimeout: 15000,
    // All 7 suites share one local Supabase stack. Running the files
    // in parallel never showed a problem on a full-size dev machine,
    // but it did on GitHub Actions' 2-core runners: bulk-signup.test.js's
    // 100 concurrent signups contending with the other files for the
    // same Postgres/GoTrue/PostgREST containers made an unrelated
    // test's post-signup self-select on profiles intermittently come
    // back empty. Running files one at a time removes that contention
    // -- a few seconds slower, but deterministic everywhere.
    fileParallelism: false,
  },
})
