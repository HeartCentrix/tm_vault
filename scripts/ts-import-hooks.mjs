// Node ESM hooks so the one-off regression scripts in this directory can
// import the real `src/**/*.ts` service modules instead of re-implementing
// them (there is no unit-test runner in this repo — see
// test-dateonly-labels.mjs for the original of this pattern).
//
// Two things stand between node and a Vite source file:
//   1. Extensionless relative imports ("../config/api") — Vite resolves
//      those, node does not. The `resolve` hook appends .ts/.tsx.
//   2. `import.meta.env` — a Vite compile-time substitution that is
//      `undefined` in node, so `import.meta.env.VITE_API_URL` throws
//      before the module body ever runs. The `load` hook rewrites it to
//      an empty object, which makes config/api.ts fall back to its
//      documented localhost default.
//
// Register from a test script with:
//   import { register } from 'node:module';
//   register('./ts-import-hooks.mjs', import.meta.url);
// then `await import(...)` the module under test.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && context.parentURL) {
    const asIs = new URL(specifier, context.parentURL);
    if (!existsSync(asIs)) {
      for (const ext of ['.ts', '.tsx']) {
        const candidate = new URL(specifier + ext, context.parentURL);
        if (existsSync(candidate)) {
          return { url: candidate.href, format: 'module-typescript', shortCircuit: true };
        }
      }
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('/src/config/api.ts')) {
    const src = await readFile(new URL(url), 'utf8');
    return {
      format: 'module-typescript',
      source: src.replace(/import\.meta\.env/g, '({})'),
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
