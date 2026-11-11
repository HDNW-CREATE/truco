import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/tests/**/*.test.ts', 'apps/*/tests/**/*.test.ts'],
    coverage: { include: ['packages/engine/src/**'], reporter: ['text'] },
  },
});
