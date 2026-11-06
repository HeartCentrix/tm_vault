import { defineConfig } from 'vitest/config';

// Unit tests only. Deliberately scoped to src/:
//   * e2e/*.spec.ts are Playwright specs — vitest cannot run them and
//     picking them up made `npm test` fail on files it does not own.
//   * .claude/worktrees/** holds stale copies of the tree from agent
//     worktrees; running those would test code that is not this checkout.
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', 'e2e/**', '.claude/**', 'dist/**'],
    environment: 'node',
  },
});
