import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: { provider: 'v8', include: ['src/components/**/*.tsx'], reporter: ['text', 'html'], reportsDirectory: 'coverage', thresholds: { lines: 85, statements: 80, branches: 70, functions: 70 } },
  },
});
