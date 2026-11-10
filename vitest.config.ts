import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['recipes/**/test/**/*.test.ts'] },
});
