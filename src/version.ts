/**
 * App version, injected at image-build time via the `VITE_APP_VERSION`
 * build-arg (see `scripts/build-image.sh`). It is derived from the git commit
 * count + short SHA, so it auto-updates with every build/commit. Falls back to
 * "dev" for local `npm run dev` where the build-arg isn't set.
 */
export const APP_VERSION: string =
  ((import.meta as any).env?.VITE_APP_VERSION as string | undefined)?.trim() ||
  'dev';
