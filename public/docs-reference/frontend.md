# TM.vault Frontend Documentation

Frontend root: `tm_vault/`

## Stack

From `package.json`:

- **React**: `^19.2.4` (`react`, `react-dom`)
- **Build tool**: **Vite** `^8.0.4` with `@vitejs/plugin-react` `^6.0.1`
- **Router**: `react-router-dom` `^7.14.0` (BrowserRouter / Routes / Route)
- **Charting**: `recharts` `^3.8.1` (used in Overview)
- **Language**: TypeScript `~6.0.2`
- **Linter**: `eslint` `^9.39.4` + `typescript-eslint` `^8.58.0` + `eslint-plugin-react-hooks` + `eslint-plugin-react-refresh`
- **E2E**: `@playwright/test` `^1.44.0`
- **Module type**: `"type": "module"` (ESM)
- No state library (Redux/Zustand/etc.), no UI kit, no CSS framework — plain CSS files per component/page.

## Build / run scripts

From `package.json` `scripts`:

| Script | Command | Purpose |
|---|---|---|
| `start` | `vite` | Dev server (alias of `dev`) |
| `dev` | `vite` | Vite dev server (port 4200, see vite.config.ts) |
| `build` | `tsc -b && vite build` | Type-check via project references then bundle |
| `lint` | `eslint .` | Lint sources |
| `preview` | `vite preview` | Serve the production build locally |
| `e2e` | `playwright test` | Run Playwright suite from `e2e/` |

## Routes

From `src/App.tsx`. Top-level `<BrowserRouter>` mounts a `<GlobalTooltip />` and listens for a custom `tm:tenant-stale` window event that redirects to `/tenants`. `isAuthenticated()` checks `localStorage.getItem('user')`.

Public routes (no layout):

| Path | Element |
|---|---|
| `/` | `<AutoRedirect />` (→ `/tenants` if authed, else `/signin`) |
| `/signin` | `<Signin />` |
| `/signup` | `<Signup />` |
| `/auth/callback` | `<AuthCallback />` |
| `/datasource-callback` | `<DatasourceCallback />` |
| `/azure-datasource-callback` | `<AzureDatasourceCallback />` |
| `/power-bi-callback` | `<PowerBICallback />` |

Protected routes nested under `<Layout />` and wrapped in `<ProtectedRoute>`:

| Path | Element |
|---|---|
| `/tenants` | `<Tenants />` |
| `/tenants/:tenantId/:serviceType/overview` | `<Overview />` |
| `/tenants/:tenantId/:serviceType/protection` | `<Protection />` |
| `/tenants/:tenantId/:serviceType/protection/recovery` | `<Recovery />` |
| `/tenants/:tenantId/:serviceType/protection/settings` | `<Settings />` |
| `/tenants/:tenantId/:serviceType/global-search` | `<GlobalSearch />` |
| `/activity` | `<Activity />` |
| `/settings` | `<Settings />` |
| `/settings/storage` | `<SettingsStoragePage />` (wrapped in `<ErrorBoundary label="Storage">`) |
| `/configuration` | `<Configuration />` |

`vercel.json` rewrites all paths to `/index.html` for SPA routing.

## Pages

All files under `src/pages/`:

| File | Purpose |
|---|---|
| `Signin.tsx` | Microsoft-only sign-in entry; calls `authService.getMicrosoftLoginUrl()` then redirects browser to MS login |
| `Signup.tsx` | Static page explaining sign-up is via org admin; only offers a "Back to Sign In" button |
| `AuthCallback.tsx` | Handles MS OAuth fragment redirect; snapshots `code`/`state` then purges URL via `history.replaceState`, calls `authService` to complete login |
| `DatasourceCallback.tsx` | M365 datasource OAuth callback; reads sessionStorage transition state and calls `authService` + `refreshDataSources()`; guards `return_to` against open-redirect |
| `AzureDatasourceCallback.tsx` | Azure datasource OAuth callback; same pattern as DatasourceCallback with stricter `safeInAppPath` open-redirect guard |
| `PowerBICallback.tsx` | Power BI datasource OAuth callback; mirrors the M365/Azure callback pattern with PowerBI-specific cleanup |
| `Tenants.tsx` | Lists connected data sources (M365 + Azure) via `getDataSources()`; searchbox; "+ Add" opens `AddDataSourceModal`; clicking a tenant navigates to its `/overview` |
| `Overview.tsx` | Per-tenant dashboard: protection %, backup-size summary, daily bytes bar chart (recharts), recent activity; "Backup now" via `triggerDatasourceBackup` |
| `Protection.tsx` | Resource grid per service type (M365: users/shared/rooms/SharePoint/groups/Entra/Power/dynamic; Azure: VMs/SQL/PostgreSQL/RGs); SLA assign/unassign, bulk assign, trigger backup, trigger discovery |
| `Recovery.tsx` | Browse snapshots and restore/download items; tabs for mail/onedrive/contacts/calendar/chats; uses `SnapshotService`, `RecoveryService`, `RestoreModal`, `DownloadModal`, Azure-specific recover modals |
| `Activity.tsx` | Three sub-views (`tasks`/`audit`/`risk`) with date + type filters; rendered via `ActivityRow`; supports CSV export and job cancel |
| `Settings.tsx` | Per-tenant settings with tabs: SLA policies, tenant info, admin-consent status, secrets; uses `SlaWizard`, `SecretsTab`, `ErrorBoundary` |
| `SettingsStorage/index.tsx` | Org-admin storage backend toggle (Azure Blob ↔ on-prem SeaweedFS); kicks 8-phase migration, streams SSE phase updates |
| `GlobalSearch.tsx` | Cross-tenant full-text search by workload (emails/files/chats/channel/copilot/calendar/contacts/exchange/planner); restore from results via `RestoreModal` |
| `Configuration.tsx` | Notification + scheduled-reports config: email recipients, Slack/Teams/Google Chat webhooks, daily/weekly/monthly schedule, manual report send |

## Components

All files under `src/components/`:

| File | Purpose |
|---|---|
| `ActivityRow.tsx` | Renders one Activity table row including expandable batch children fetched via `fetchBatchChildren`; portal for popovers |
| `AddDataSourceModal.tsx` | Modal offering "Connect Microsoft 365" / "Connect Azure" buttons that fetch the OAuth URL and redirect |
| `AddSecretModal.tsx` | Two-variant secret creator: `login` (SQL/Postgres credential) or `kms` (AES-256 KMS key); posts to `/tenants/{id}/secrets` |
| `AzureDbRecoverModal.tsx` | Azure SQL DB recovery wizard (target server, db name, secret, version); embeds `AddSecretModal` + `InfoHint` tooltips |
| `AzurePgRecoverModal.tsx` | Azure PostgreSQL flexible-server recovery wizard; mirrors `AzureDbRecoverModal` structure |
| `AzureVmView.tsx` | Azure VM snapshot browser with imperative `download()` handle; switches between disk/file tabs and drives toolbar download |
| `BackupSizeSummary.tsx` | Renders storage rollup (total + per-content-type) for a resource; either consumes a passed `summary` or fetches via `SnapshotService.getStorageSummary` |
| `BrandLogos.tsx` | Inline SVG `MicrosoftLogo` + `AzureLogo` components matching Microsoft brand kit |
| `DownloadModal.tsx` | Configures download/export per content type (format, folder-scope, single-vs-zip); also embeds `EntraDownloadForm` for Entra exports |
| `EntraDownloadForm.tsx` | Sub-form picking Entra sections (users/groups/roles/security/audit/applications/intune/adminunits), format (csv/json), nested-detail toggle |
| `EntraRestoreForm.tsx` | Sub-form for Entra restore: scope radio (selected/directory), section checkboxes, includeGroupMembership/includeAuMembership toggles |
| `ErrorBoundary.tsx` | Generic class-based React error boundary with retry button; used to wrap `SettingsStoragePage` |
| `GlobalTooltip.tsx` | Single delegated tooltip listener (150ms show delay) that pops a styled tip on `[title]` / `[data-orig-title]` elements; portal-rendered |
| `Header.tsx` | Top bar: datasource dropdown, search input, theme toggle (writes `tm-theme` to localStorage), user menu with sign-out |
| `Layout.tsx` | Authenticated shell: `<Sidebar />` + `<Header />` + `<ServiceNav />` + `<Outlet />`; syncs `selectedSource` from URL and tracks navigation |
| `RecoveryToolbar.tsx` | Shared toolbar between content-tabs and rows on Recovery: search box, version (snapshot) picker, Download + Recover buttons |
| `ResourceGroupManager.tsx` | CRUD UI for tag/property resource groups (afi.ai-style auto-protection) with policy attach/detach |
| `RestoreModal.tsx` | Universal restore modal; switches mode based on `resourceKind` (user/mailbox, OneDrive, SharePoint, Entra) and embeds `EntraRestoreForm` |
| `RoundedSelect.tsx` | Custom dropdown with rounded popup menu (replaces native `<select>` which can't be styled) |
| `SecretsTab.tsx` | Settings → Secrets table listing AES-256 KMS keys; opens `AddSecretModal` (variant=kms) |
| `ServiceNav.tsx` | Sub-tabs under header (Overview / Protection / Global search…); only renders inside `/tenants/:id/:serviceType/` context |
| `Sidebar.tsx` | Left vertical nav (Service / Activity / Configuration / Settings); restores last service sub-route via `getNavigationState()` |
| `SlaWizard.tsx` | Multi-step SLA policy creator/editor with retention/archive day picker, exclusions, BYOK/WORM gating via `useActiveBackend` |

## API services

All files under `src/services/`. Every service uses the central `API` object in `src/config/api.ts` (which derives all endpoints from `VITE_API_URL`, default `http://localhost:8080/api/v1`).

| File | Backend endpoint(s) wrapped |
|---|---|
| `activity.ts` | `API.ACTIVITY.LIST` (GET + `/batches/{id}/children` + `/export`); `API.JOBS.CANCEL` |
| `adminStorage.ts` | `API.ADMIN_STORAGE.*` — status, backends, toggle (POST), events (GET list), abort (POST), event SSE stream |
| `audit.ts` | `API.AUDIT.LIST` + `.DETAILS`; also `/risk-signals` and `/export` derived from the LIST URL |
| `auth.ts` | `API.AUTH.*` — login URL, datasource URL (M365/Azure), Power BI URL, callbacks, refresh, logout, me; `API.ADMIN_CONSENT.*` for status checks |
| `datasource.ts` | `API.TENANTS.LIST` (in-memory cached); fans tenants out into per-`type` `DataSourceType` entries |
| `navState.ts` | None — pure localStorage helper (`tm_vault_nav_state`) for sidebar / tab restoration |
| `recovery.ts` | `API.SNAPSHOTS.ITEMS` + `.ITEM_DETAIL`; `API.RESTORE.TRIGGER`, `API.EXPORT.TRIGGER`; `API.RESOURCES.EXPORT_OR_RESTORE`; `API.SEARCH.SEARCH`; `API.EXPORT.CHAT.{TRIGGER,ESTIMATE,STATUS}` |
| `reports.ts` | `API.REPORTS.CONFIG` (GET/PUT/POST), `.HISTORY`, `.HISTORY_DETAIL`, `.SEND` |
| `resource.ts` | `API.RESOURCES.{LIST,BY_TYPE,ASSIGN_POLICY,UNASSIGN_POLICY,BULK_ASSIGN,BULK_UNASSIGN,ARCHIVE,UNARCHIVE,DELETE}`; `API.JOBS.{TRIGGER_BACKUP,TRIGGER_BULK,TRIGGER_DATASOURCE}`; ad-hoc `/progress/resource/{id}`, `/progress/resources`, `/tenants/{id}/users/{id}/backup` and `/discover-content` |
| `restore.ts` | `API.RESTORE.{TRIGGER,MAILBOX,ONEDRIVE,SHAREPOINT,ENTRA_OBJECT,STATUS,HISTORY}`; returns `API.EXPORT.DOWNLOAD(jobId)` URL |
| `search.ts` | `API.SEARCH.{SEARCH,SUGGESTIONS,REINDEX}` |
| `sla.ts` | `API.POLICIES.*` (list/create/update/delete + exclusions); `API.RESOURCE_GROUPS.*` (list/create/update/delete + attach/detach policy) |
| `snapshot.ts` | `API.SNAPSHOTS.*` (LIST, CONTENT_SNAPSHOTS, STORAGE_SUMMARY, DETAIL, ITEMS, ITEM_DETAIL, ITEM_ATTACHMENTS, FOLDERS, MAIL, ONEDRIVE, CONTACTS, CALENDAR, CHATS, CHAT_GROUPS, CONTACT_FOLDERS, AZURE_DB_TABLE); `API.RECOVERY.{RESOURCES_WITH_BACKUPS,SEARCH_ITEMS}`; SharePoint subsites via `/resources/{id}/subsites` |
| `tenant-info.ts` | `API.TENANTS.INFO`, `API.TENANTS.USAGE_REPORT` |

## State management

No React Context, no Redux, no Zustand. State is local-component + persistence in `localStorage` / `sessionStorage`.

Persistence keys (from grep across `src/`):

- `user` — auth breadcrumb (set by `auth.ts`, read by `App.tsx`/`main.tsx`/`Header.tsx`). Actual token is an HttpOnly cookie.
- `access_token`, `refresh_token` — legacy; removed on logout.
- `tm-theme` — `'light' | 'dark'`, read in `main.tsx` pre-render and in `Header.tsx`.
- `selected_datasource` — JSON snapshot of the active `DataSourceType` (`Layout.tsx`, `Header.tsx`, `Activity.tsx`).
- `tm_vault_nav_state` — `{ tenantId, serviceType, subRoute, tabStates }`, owned by `services/navState.ts` and the `useTrackNavigation`/`usePersistentTab` hooks; also touched by `resource.ts` and `Sidebar.tsx`.
- Per-page persistence (e.g. `Protection.tsx` stores in-flight `backingUp` jobs in its own `STORAGE_KEY`).

`sessionStorage` is used by `*Callback.tsx` pages to stash OAuth `state`/`return_to`/`tenant id` for the lifetime of the redirect tab; old `localStorage` entries are read once for backward-compat then deleted.

Cross-cutting events:

- `main.tsx` monkey-patches `window.fetch` to inject credentials (HttpOnly cookie auth), single-flight a `/auth/refresh` on 401, and dispatch `tm:auth-signout` etc. on failure.
- `App.tsx` listens for `tm:tenant-stale` and redirects to `/tenants` when the backend 404s on a cached tenant id.

In-memory caching: `services/datasource.ts` caches the tenants list and a single in-flight fetch promise.

## Env / config

`vite.config.ts`:
```ts
defineConfig({ plugins: [react()], server: { port: 4200 } })
```
Dev server runs on **port 4200**.

`tsconfig.json` uses project references → `tsconfig.app.json` (app code) + `tsconfig.node.json` (vite config). Highlights from `tsconfig.app.json`:
- `target: es2023`, `lib: ES2023 + DOM + DOM.Iterable`
- `module: esnext`, `moduleResolution: bundler`
- `jsx: react-jsx`, `types: ["vite/client"]`
- Strict cleanup: `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `noFallthroughCasesInSwitch`
- `allowImportingTsExtensions: true`, `noEmit: true`

`vercel.json` — SPA rewrite of every path to `/index.html`.

**VITE_ env vars used**:
- `VITE_API_URL` — base API URL. Default `http://localhost:8080/api/v1`. Referenced in:
  - `src/config/api.ts` (single source for all endpoint constants)
  - `src/main.tsx` (for the global fetch refresh interceptor's `_REFRESH_URL` / `_SIGNIN_URL` / `_LOGIN_CALLBACK_URL`)

No other `VITE_*` variables are present in source.

## E2E setup

Playwright. Single spec file `e2e/chat-export.spec.ts`:

- Test: **"single-thread chat export HTML"** — signs in (filling `name=email` / `name=password` and clicking `button[type=submit]`), navigates to Recovery, ticks a chat folder, opens Download, picks "Export as HTML", clicks `button.btn-download`, waits up to **120s** for the download event and asserts a path exists.
- Reads `E2E_URL` (default `http://localhost:5173`), `E2E_USER`, `E2E_PASS` from env.
- No `playwright.config.ts` in `e2e/`; uses Playwright defaults invoked via `npm run e2e`.
- The selector contract assumes the older email/password sign-in form — not the current Microsoft-only `Signin.tsx`, suggesting this test may be stale or expects a backend-bypass flow.
