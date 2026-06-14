import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Provide stub values for env vars required at module load time.
    // Individual tests mock the Supabase client so these are never used in real calls.
    env: {
      SUPABASE_URL:              'https://test.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      DATABASE_URL:              'postgresql://test:test@localhost:5432/test',
      // Prevents OpenAI/Anthropic constructors from throwing at module load time.
      // Individual tests mock the AI client so this key is never used in real calls.
      OPENAI_API_KEY:    'sk-test-placeholder',
      ANTHROPIC_API_KEY: 'sk-ant-test-placeholder',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
    },
  },
})
