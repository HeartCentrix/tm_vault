# TMvault Backend Services Documentation

Generated from `tm_backend/services/` on 2026-05-18. Each entry was extracted directly from the service's `main.py`. Unless otherwise noted, citations point to that file.

---

## alert-service

### Purpose
Manages alerts, notifications, access groups, and export-completion email notifications. Read-mostly FastAPI service backed by `Alert` and `AccessGroup` SQLAlchemy models. Many endpoints (webhooks, notification settings, self-service settings, IP restrictions) are placeholder stubs that return static JSON. See `alert-service/main.py:1` for the module docstring.

### Endpoints
- `GET /health` (`:26`) — health check.
- `GET /api/v1/alerts` (`:33`) — paginated list with `unresolved` and `tenantId` filters.
- `GET /api/v1/alerts/{alert_id}` (`:70`) — fetch one alert.
- `POST /api/v1/alerts/{alert_id}/resolve` (`:84`) — mark resolved (204).
- `GET /api/v1/alerts/notifications/settings` (`:96`) — static placeholder response.
- `PUT /api/v1/alerts/notifications/settings` (`:101`) — echoes payload (stub).
- `GET /api/v1/alerts/webhooks` (`:106`) — stub, returns `[]`.
- `POST /api/v1/alerts/webhooks` (`:111`) — stub create.
- `DELETE /api/v1/alerts/webhooks/{webhook_id}` (`:116`) — stub.
- `POST /api/v1/alerts/webhooks/{webhook_id}/test` (`:121`) — stub test.
- `GET /api/v1/access-groups` (`:128`) — paginated list, optional tenant filter.
- `POST /api/v1/access-groups` (`:156`) — create AccessGroup.
- `PUT /api/v1/access-groups/{group_id}` (`:164`) — update via free-form dict.
- `DELETE /api/v1/access-groups/{group_id}` (`:178`) — delete.
- `POST /api/v1/access-groups/{group_id}/members` (`:189`) — stub, no DB write.
- `DELETE /api/v1/access-groups/{group_id}/members/{member_id}` (`:194`) — stub.
- `GET /api/v1/access-groups/self-service/settings` (`:199`) — static stub.
- `PUT /api/v1/access-groups/self-service/settings` (`:204`) — echoes payload.
- `GET /api/v1/access-groups/ip-restrictions` (`:209`) — static stub.
- `PUT /api/v1/access-groups/ip-restrictions` (`:214`) — echoes payload.
- `POST /api/v1/alerts/notify/export-completed` (`:236`) — accepts `ExportNotification` payload and best-effort sends an email via `send_email` (helper imported lazily; falls back to print).

### Features
- Persisted alert CRUD on `Alert` table.
- Persisted access-group CRUD on `AccessGroup` table.
- Pagination shape: `{content, totalPages, totalElements, size, number}` mirroring Spring conventions.
- Fire-and-forget export-completion email with formatted summary (`:241` builds subject/body).
- Several feature surfaces (webhooks, IP restrictions, members, notification settings) are stub endpoints that just round-trip the payload.

### Env vars referenced
None directly in this file.

### External deps
- DB tables: `alerts`, `access_groups` (via `shared.models.Alert`, `AccessGroup`).
- `shared.core_metrics.init()` on startup.
- Optional `send_email` helper (looked up dynamically via `NameError` fallback).

### Notable patterns
- Resolution timestamp coerced to naive UTC for `Alert.resolved_at` (`:92`) to match `TIMESTAMP WITHOUT TIME ZONE`.
- Export-completion handler swallows mail-send errors so the 202 response is never blocked (`:259-270`).

---

## audit-service

### Purpose
Tracks all backup/restore/admin actions and surfaces three primary feeds: Activity (operator-facing job timeline), Audit (compliance event log), and Risk Signals. Consumes the `audit.events` RabbitMQ queue, ingests Microsoft Graph audit logs, supports SIEM webhook forwarding, and provides CSV export. See `audit-service/main.py:1`.

### Endpoints
- `GET /health` (`:683`)
- `GET /api/v1/activity` (`:1023`) — batch-rollup Activity feed with multiple filters.
- `GET /api/v1/activity/export` (`:1578`) — CSV export of activity rows.
- `GET /api/v1/activity/batches/{batch_id}/children` (`:1714`) — drill into a batch.
- `POST /api/v1/audit/log` (`:1923`) — append a `AuditEvent`.
- `GET /api/v1/audit/events` (`:2185`) — paginated audit listing with filters.
- `GET /api/v1/audit/resource/{resource_id}` (`:2243`) — per-resource audit timeline.
- `GET /api/v1/audit/events/{event_id}` (`:2275`) — single event.
- `GET /api/v1/audit/risk-signals` (`:2285`) — ransomware/anomaly events.
- `GET /api/v1/audit/export` (`:2380`) — CSV export for compliance.
- `GET /api/v1/audit/presets` (`:2436`) — built-in filter presets (e.g. chat exports).
- `GET /api/v1/audit/actions` (`:2442`) — list of action codes + descriptions.
- `GET /api/v1/audit/stats` (`:2458`) — aggregate counts.
- `GET /api/v1/audit/siem/stream` (`:2498`) — SSE stream of audit events for SIEM tools.
- `POST /api/v1/audit/siem/webhook` (`:2579`) — register an outbound webhook.
- `POST /api/v1/audit/siem/webhook/{webhook_id}/test` (`:2608`) — send a test event.
- `GET /api/v1/audit/graph-apps` (`:2628`) — list Graph apps configured via `multi_app_manager`.
- `POST /api/v1/audit/ingest/graph/{tenant_id}` (`:2637`) — pull Microsoft Graph audit logs into local store.

### Features
- ~50 well-known action codes in the `ACTIONS` dict (`:565-600`).
- Batch rollup: collapses fan-out Jobs sharing a `spec.batch_id` to one Activity row (delegates to `shared.batch_rollup`).
- Service-type filtering (`m365` vs `azure`) with explicit resource-type sets (`M365_RESOURCE_TYPES`, `AZURE_RESOURCE_TYPES`).
- `Warning`/`Done`/`In Progress` status semantics with `RANSOMWARE_SIGNAL` deliberately excluded from Activity (`:610`).
- Periodic chat-integrity loop and archived-purge loop started at app startup (`:555-556`).
- Background consumer of `audit.events` RabbitMQ queue.
- In-memory `_running_job_cache` refreshed every second for live "details" strings.

### Env vars referenced
- `CHAT_INTEGRITY_INTERVAL_S` (default `24h`) — `:351`.
- `CHAT_INTEGRITY_TOLERANCE_PCT` (default `1.0`) — `:354`.
- `ARCHIVED_PURGE_GRACE_DAYS` (default `30`) — `:498`.
- `ARCHIVED_PURGE_INTERVAL_S` (default `3600`) — `:499`.
- `ACTIVITY_GROUP_DEFAULT` (default `batch`) — `:1051`, `:1596`.

### External deps
- DB tables: `audit_events`, `jobs`, `snapshots`, `resources`, `tenants`, `organizations`, `sla_policies`.
- Queue consumed: `audit.events` (`message_bus.consume`, `:2803`).
- Microsoft Graph (`shared.graph_client.GraphClient`, `shared.multi_app_manager.multi_app_manager`).
- Sibling file `activity_backup.py` loaded via `importlib.util` (`:41-51`) to provide `shape_activity_row`.

### Notable patterns
- Hyphen-in-name import workaround via `importlib.util.spec_from_file_location` to share helpers with backup-worker (`:41-51`).
- Terminal-status-first branching in `_compute_details` (`:69`) so a completed job never shows stale "Progress: 95%" text.
- Activity grouping uses spec.batch_id when present, falling back to (tenant, triggered_by, second-precision timestamp).
- Background loops launched in `@app.on_event("startup")` and torn down on shutdown (`:547-562`).
- Server-Sent Events used for the SIEM stream.
- CSV export streams via `StreamingResponse` to avoid buffering large exports.

---

## auth-service

### Purpose
Handles authentication, Microsoft/Azure/Power-BI OAuth flows, JWT access/refresh tokens, and admin-consent status. The module docstring is a single line (`:1`).

### Endpoints
- `GET /health` (`:100`)
- `GET /api/v1/auth/microsoft/url` (`:169`) — build Microsoft sign-in URL.
- `GET /api/v1/auth/microsoft/datasource/url` (`:187`) — admin-consent URL for the M365 data-source app.
- `GET /api/v1/auth/azure/datasource/url` (`:205`) — admin-consent URL for the Azure data-source app.
- `GET /api/v1/auth/power-bi/url` (`:231`) — sign-in URL with Power BI/Fabric scopes.
- `POST /api/v1/auth/callback` (`:283`) — OAuth code exchange; returns `LoginResponse` with access+refresh tokens.
- `POST /api/v1/auth/microsoft/datasource/callback` (`:370`) — completes M365 admin consent, creates `Tenant`.
- `POST /api/v1/auth/azure/datasource/callback` (`:568`) — completes Azure admin consent.
- `POST /api/v1/auth/power-bi/callback` (`:753`) — exchanges Power BI code, stores `AdminConsentToken`.
- `GET /api/v1/admin-consent/m365/status` (`:911`) — M365 consent status.
- `GET /api/v1/admin-consent/azure/status` (`:934`) — Azure consent status.
- `GET /api/v1/admin-consent/power-bi/readiness` (`:974`) — confirms Power BI service principal has access (calls Power BI APIs).
- `POST /api/v1/auth/refresh` (`:1170`) — exchange refresh token for new access token.
- `POST /api/v1/auth/logout` (`:1229`) — revoke refresh token.
- `GET /api/v1/auth/me` (`:1256`) — return current user with refreshed claims from DB.

### Features
- Microsoft OAuth (login + data-source admin consent) and Azure data-source consent.
- Power BI / Fabric service-principal readiness checks.
- JWT access + refresh token issuance via `shared.security.create_access_token` / `create_refresh_token`.
- Claims always re-loaded from DB on `/refresh` and `/me` so role changes propagate (`:76`).
- Refresh-token revocation list (`is_refresh_token_revoked`, `revoke_refresh_token`).
- Power BI error normalization (`_power_bi_error_detail`, `:47`) for clearer UI messages.

### Env vars referenced
None directly — all config via `shared.config.settings` (`MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`, `AZURE_AD_*`, etc.).

### External deps
- DB tables: `platform_users`, `user_role_mappings`, `organizations`, `tenants`, `admin_consent_tokens`, `resources`.
- Microsoft identity endpoints (`login.microsoftonline.com`) via `httpx`.
- `shared.power_bi_client.PowerBIClient` for Power BI readiness.
- `shared.security` for token helpers.

### Notable patterns
- Single-source-of-truth claim loader `_load_token_claims_from_db` (`:76`) prevents stale role/tenant grants from being frozen in tokens.
- Token endpoint can only redeem one resource's scopes at a time; Power BI flow stores the refresh token to mint Fabric tokens later (`:69-73`).

---

## autoscaler

### Purpose
Queue-depth-driven replica autoscaler. Polls RabbitMQ management API for per-queue depth and calls the orchestrator scaling API to set the replica count. Per-service config with min/max/target-depth and hysteresis. See `autoscaler/main.py:1-49`.

### Endpoints
None — this is an async loop (no FastAPI app); entry point is `asyncio.run(main())` (`:292`).

### Features
- Per-service config (default for backup_worker, backup_worker_heavy, discovery_worker, restore_worker) with `min_replicas`, `max_replicas`, `target_depth_per_replica` (`:69-98`).
- Override config via `AUTOSCALER_CONFIG` JSON env var.
- Scaling formula `desired = clamp(ceil(depth/target), min, max)` (`:9-15`).
- Hysteresis to prevent flapping (skips change if delta < `SCALE_HYSTERESIS`).
- Dry-run mode when `RAILWAY_API_TOKEN` is unset (logs decisions only).
- Treats missing queues as zero depth (404 = empty).

### Env vars referenced (file lines 24-41)
- `RABBITMQ_MGMT_URL` (default `http://rabbitmq:15672`)
- `RABBITMQ_MGMT_USER` (default `guest`)
- `RABBITMQ_MGMT_PASSWORD` (default `guest`)
- `RAILWAY_API_TOKEN`
- `RAILWAY_PROJECT_ID`
- `RAILWAY_ENVIRONMENT_ID`
- `AUTOSCALER_CONFIG`
- `SCALE_INTERVAL_S` (default `60`)
- `SCALE_HYSTERESIS` (default `1`)
- `CORE_METRICS_PORT` (referenced in docstring, default `9103`)

### External deps
- RabbitMQ management API at `RABBITMQ_MGMT_URL`.
- Orchestrator scaling API (e.g. Kubernetes Deployment patch, ECS UpdateService) at the URL specified in env config (`:139`).
- `shared.core_metrics` for Prometheus metrics (`set_queue_depth`, `set_worker_active_jobs`).

### Notable patterns
- Single-tick failure mode: if ALL probes fail, refuses to change replicas (`:212-214`).
- Loop body wrapped in try/except so a single tick's exception doesn't kill the loop (`:281-287`).
- Tracks `current_replicas` in-process; no DB persistence.

---

## backup-scheduler

### Purpose
SLA-policy-driven backup scheduler. Scans active resources grouped by SLA policy, schedules cron jobs via APScheduler based on each policy's `frequency`, filters resources by per-policy backup flags (`backup_exchange`, `backup_onedrive`, etc.), and dispatches batched backup messages to RabbitMQ. Also runs partition stale-sweep, late-bytes reconcile, Tier-2 backstop, lifecycle/immutability reconciler, and orphan-sweep loops. See `backup-scheduler/main.py:1-12`.

### Endpoints
- `GET /health` (`:1587`)
- `POST /scheduler/policy/{policy_id}/trigger` (`:1593`) — manually dispatch a policy.
- `POST /scheduler/reschedule-all` (`:1600`) — rebuild APScheduler from DB.
- `POST /scheduler/reconcile-lifecycle` (`:1607`) — kick the lifecycle/immutability/legal-hold reconciler (called by resource-service after SLA save).
- `POST /scheduler/resource/{resource_id}` (`:1617`) — immediate one-off backup (publishes to `backup.urgent`).

### Features
- `RESOURCE_TYPE_TO_SLA_FLAG` map (`:46-89`) determines which workload toggle gates each resource type.
- APScheduler-based dynamic cron scheduling per SLA policy.
- Batched dispatch grouped by `(resource_type, tenant_id)` in pages of 1000 (`:1684-1688`).
- Routing-key picker: `backup.urgent` / `backup.high` / `backup.normal` / `backup.low` depending on policy frequency.
- Partition fan-out queues: `backup.onedrive_partition`, `backup.chats_partition`, `backup.mail_partition`, `backup.sharepoint_partition` (`:914-966`).
- Stale-snapshot and stale-partition sweepers (30-min idle horizon).
- `PARTITION_MAX_RETRIES` cap on re-publishing dead partitions.
- Late-bytes reconcile on terminal bulks (corrects `bytes_processed` post-hoc).
- Tier-2 discovery backstop loop (`:1266`).
- Orphan job sweep (`:2361`).
- Backup verification sampler (`:2434-2435`).
- Lifecycle reconciler with bounded parallelism and per-tenant timeout (`:2814-2825`).
- Sweep step with attempt cap + per-sweep timeout (`:3113-3115`).
- Lifecycle uses Postgres advisory locks for cross-instance coordination (`:3158`).

### Env vars referenced
- `ONEDRIVE_PARTITION_STALE_SWEEP_MIN` (default `30`) — `:737`.
- `PARTITION_MAX_RETRIES` (default `5`) — `:740`.
- `TIER2_DISCOVERY_BACKSTOP_S` (default `7h`) — `:1266`.
- `ORPHAN_SWEEP_INTERVAL_S` (default `60`) — `:2361`.
- `BACKUP_VERIFY_SAMPLE_SIZE` (default `50`) — `:2434`.
- `BACKUP_VERIFY_LOOKBACK_HOURS` (default `24`) — `:2435`.
- `LIFECYCLE_PARALLELISM` (default `20`) — `:2814`.
- `LIFECYCLE_TENANT_TIMEOUT_S` (default `600`) — `:2820`.
- `LIFECYCLE_WORKLOAD_PARALLELISM` (default `4`) — `:2825`.
- `LIFECYCLE_SWEEP_ATTEMPT_CAP` (default `25`) — `:3113`.
- `LIFECYCLE_SWEEP_PARALLELISM` (default `10`) — `:3114`.
- `LIFECYCLE_SWEEP_TIMEOUT_S` (default `60`) — `:3115`.

### External deps
- DB tables: `resources`, `sla_policies`, `tenants`, `jobs`, `organizations`, `snapshots`, `snapshot_partitions`, `backup_batches`.
- RabbitMQ queues published: `backup.urgent` / `backup.high` / `backup.normal` / `backup.low`, the four partition queues, `discovery.tier2`, `discovery.m365`, `audit.events`.
- `shared.power_bi_client.PowerBIClient`.
- `shared.audit.emit_backup_triggered` for audit-event emission.
- `shared.message_bus.create_mass_backup_message` / `create_backup_message` / `create_audit_event_message`.

### Notable patterns
- APScheduler `AsyncIOScheduler` for dynamic policy cron jobs.
- Postgres advisory locks (`pg_try_advisory_lock`, `:3158`) for lifecycle reconciliation cross-instance idempotency.
- Idempotent re-publish guarded by parent-job-status check ("if CANCELLING/CANCELLED, don't resurrect", `:730-734`).
- Bounded asyncio.gather concurrency for workload fan-out (`:2939`, `:3054`, `:3258`).
- Stable 64-bit advisory-lock keys (`:3068`).

---

## dashboard-service

### Purpose
Read-only aggregate metrics service for the operator dashboard. Computes overview, 24-hour status, 7-day daily status, protection-status buckets, and backup-size growth. Bucketing supports IANA-tz query param so days align with the operator's local calendar. See `dashboard-service/main.py:1-7`.

### Endpoints
- `GET /health` (`:235`)
- `GET /api/v1/dashboard/overview` (`:240`) — totals: resources, protected, failed/pending backups, storage used, last backup.
- `GET /api/v1/dashboard/status/24hour` (`:363`) — `{success, warnings, failures}` rolled up over batch groups.
- `GET /api/v1/dashboard/status/7day` (`:420`) — daily breakdown with `tz` param.
- `GET /api/v1/dashboard/protection/status` (`:521`) — per-bucket (users, sharedMailboxes, rooms, sharepointSites, groupsAndTeams, entraId, powerPlatform) protection coverage.
- `GET /api/v1/dashboard/backup/size` (`:635`) — daily backup-size growth over 30 days.

### Features
- Service-type (`m365` vs `azure`) toggling switches the resource-type set (`:217`).
- Per-bucket resource-type mapping kept in sync with frontend `M365_TAB_TYPE_MAP` (`:140`).
- Batch grouping shared with audit-service via `_batch_group_key` (`:296`) and `_roll_up_group_outcome` (`:323`) so one operator click = one task.
- Tier-2 storage dedup via `exclude_tier2_storage_dupes_clause()` from `shared.storage_rollup`.
- SharePoint-name-collision exclusion replicates resource-service's `/by-type` logic in raw SQL (`:594-613`).
- Read-only lifespan: skips schema-migration code on startup so dashboard never blocks behind it (`:107`).
- DB readiness probe with exponential backoff up to `timeout_total_s=120` (`:57`).

### Env vars referenced
None.

### External deps
- DB tables: `resources`, `jobs`, `tenants`, `snapshots`, `sla_policies`, plus the `snapshot_items` rollup.
- `shared.storage_rollup.exclude_tier2_storage_dupes_clause`.
- `shared.models.UI_HIDDEN_TYPES`.

### Notable patterns
- IANA-tz bucketing (`_bucket_date`, `_resolve_tz`) so operators in IST see daily boundaries at midnight IST instead of UTC.
- Naive UTC timestamps used in queries to avoid asyncpg tz-aware vs `TIMESTAMP WITHOUT TIME ZONE` errors (`:256`).
- Two-shape backup-job match (per-resource via `resource_id`, batch via `tenant.type`) in `_build_service_clause` (`:276`).
- Backup-size series uses `Resource.last_backup_at` + `storage_bytes` as the single source of truth (NOT snapshot.bytes_added) — comment at `:658-663`.

---

## delta-token

### Purpose
Centralized delta-token service for Microsoft Graph incremental syncs. Stores and retrieves per-resource (and per-folder for Exchange) delta tokens with Redis cache + Postgres `Snapshot.delta_token` fallback. Supports forced invalidation that triggers a full Graph resync on next backup, gated by audit-logged rate-limited destructive operation. See `delta-token/main.py:1-11`.

### Endpoints (all non-health require `X-Internal-Api-Key`)
- `GET /health` (`:127`)
- `GET /delta-token/{resource_id}` (`:133`) — fetch token (Redis → latest Snapshot fallback).
- `POST /delta-token` (`:187`) — save token (writes to Redis with 30-day TTL).
- `DELETE /delta-token/{resource_id}?confirm=force-full-sync` (`:215`) — invalidate; rate-limited.
- `GET /delta-token/history/{resource_id}` (`:323`) — list recent snapshot tokens.
- `GET /delta-tokens/bulk` (`:351`) — fetch tokens for multiple resources (comma-separated `resource_ids`).

### Features
- Internal-API-key auth via `require_internal_api_key` (`:44`) — fails closed if `INTERNAL_API_KEY` not configured (returns 503).
- Redis-cached tokens with `delta_token:{resource_id}` or `delta_token:{resource_id}:{folder_id}` keys (`:383`).
- Postgres-backed fallback via latest `Snapshot.delta_token`.
- Rate-limited invalidation: one per `INVALIDATION_MIN_INTERVAL_SECONDS=60` (`:41`) via Redis SETEX NX.
- Audit logger `delta_token.audit` for invalidation events with API-key fingerprint (first 12 hex chars of sha256) — never the raw key.
- UUID validation up front for `resource_id` to prevent log/Redis-key injection (`:244`).
- Confirmation gate: invalidate requires `?confirm=force-full-sync`.

### Env vars referenced
None directly — uses `shared.config.settings` (`REDIS_ENABLED`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_DB`, `INTERNAL_API_KEY`).

### External deps
- Redis for caching.
- DB tables: `snapshots`, `resources`, `tenants`.

### Notable patterns
- `secrets.compare_digest` for constant-time API-key compare (`:60`).
- Fail-closed when shared secret missing (returns 503, never silently allows).
- Per-resource Redis rate-limit key `delta_token_rl:{resource_id}:{folder_id|*}` falls open if Redis is unavailable (legacy dev mode).
- Hash-prefix audit fingerprint to enable correlation without log-aggregator leakage of raw keys.

---

## dr-replication-worker

### Purpose
Async cross-region DR replication. Two main loops: (1) scan completed snapshots with `dr_replication_status='pending'|'failed'` and trigger server-side Azure blob-to-blob copies to a per-tenant DR storage account; (2) replicate the three "chat singleton" Postgres tables (`chat_threads`, `chat_thread_messages`, `chat_url_cache`) to a DR Postgres via `DR_PG_DSN`. Also reconciles DR-container lifecycle policies every 6h. See `dr-replication-worker/main.py:1-13`.

### Endpoints
None — async worker, entry `asyncio.run(main())` (`:821`).

### Features
- 5-minute scan loop (`:788`) with up to `MAX_REPLICATION_ATTEMPTS=10` per snapshot (`:56`).
- 30-min per-blob `COPY_TIMEOUT_SECONDS` (`:57`).
- Server-side Azure copy: SAS-URL on source blob with 4h read-only expiry, `start_copy_from_url` on DR `BlobClient`.
- DR container naming `{primary}-dr` based on `azure_storage_manager.get_container_name(tenant, workload)` (`:211-212`).
- Workload mapping pulled from `RESOURCE_TYPE_TO_WORKLOADS` (canonical) — fixes prior hardcoded "files"/"azure-sql" drift (`:41-53`).
- Legal-hold replication (best-effort) when `tenant.extra_data.legal_hold_enabled`.
- 6-hour DR lifecycle reconciler (`reconcile_dr_lifecycle_policies`, `:445`) iterates every known workload, applies hot/cool/archive retention from SLA.
- Chat-singleton replication (`replicate_chat_singletons_once`, `:592`): incremental UPSERT on `chat_thread_messages` via `created_at` watermark stored in `dr_chat_replication_state` on DR PG.

### Env vars referenced
- `DR_PG_DSN` (`:573`) — DR Postgres DSN; loop no-ops when unset.
- `DR_CHAT_REPL_INTERVAL_S` (default `600`) — `:574`.

Plus indirect via `shared.config.settings`: `DB_USERNAME`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `RABBITMQ_ENABLED`.

### External deps
- Source storage: `azure_storage_manager` shards.
- DR storage: per-tenant `Tenant.dr_storage_account_name` + `dr_storage_account_key_encrypted` (decrypted via `shared.security.decrypt_secret`).
- DB tables: `snapshots`, `snapshot_items`, `resources`, `tenants`, `sla_policies`, `chat_threads`, `chat_thread_messages`, `chat_url_cache`, `dr_chat_replication_state`.

### Notable patterns
- Server-side copy polled via `_wait_for_copy` (5s tick, progress logged every 30s, `:407`).
- Watermark persisted on DR side so a worker restart doesn't re-replicate everything (`:616-620`).
- Atomic UPSERT on natural keys: `(tenant_id, chat_id)` for threads, `(tenant_id, url_sha256)` for URL cache, `(chat_thread_id, message_external_id)` for messages.
- Three concurrent loops via `asyncio.gather(scan_loop, dr_lifecycle_loop, chat_singleton_repl_loop)` (`:817`).
- Permanent-fail escalation after `MAX_REPLICATION_ATTEMPTS` (`:394-399`).
- Metadata-only snapshots (zero items) marked replicated immediately (`:258-266`).

---

## graph-proxy

### Purpose
Microsoft Graph API gateway with `$batch` support and adaptive throttling. Caches tokens in Redis, enforces per-tenant request/concurrency limits, and handles 429 retries. Port 8009. See `graph-proxy/main.py:1-11`.

### Endpoints
- `GET /health` (`:164`)
- `POST /graph/batch?tenant_id=…` (`:174`) — execute a Graph `$batch` (up to 20 sub-requests).
- `GET /graph/{path:path}?tenant_id=…` (`:232`) — pass-through GET proxy.
- `POST /graph/{path:path}?tenant_id=…` (`:238`) — pass-through POST proxy.
- `GET /throttle/stats/{tenant_id}` (`:351`) — per-tenant counters.
- `GET /throttle/stats` (`:358`) — all-tenants snapshot.

### Features
- `AdaptiveThrottleManager` (`:51`) with `MAX_REQUESTS_PER_5MIN=10000` and `MAX_CONCURRENT=20` per tenant.
- 5-minute sliding window per tenant; backoff window honoured when set.
- `record_throttle` arms backoff using server-provided `Retry-After`.
- Token caching in Redis (`graph_token:{tenant_id}`) with 5-min buffer before expiry (`:343`).
- Auto-retry once on 429 with sleep-Retry-After then re-check throttle.
- 60s timeout for batch, 30s for individual requests.

### Env vars referenced
None directly — uses `shared.config.settings` (`REDIS_ENABLED`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_DB`, `AZURE_AD_CLIENT_ID`, `AZURE_AD_CLIENT_SECRET`).

### External deps
- Redis (token cache).
- Microsoft identity `login.microsoftonline.com/{tenant}/oauth2/v2.0/token`.
- Microsoft Graph `graph.microsoft.com/v1.0/*` and `/v1.0/$batch`.

### Notable patterns
- In-memory per-tenant throttle state (not Redis-distributed) — `ThrottleState` per `tenant_id` (`:43`).
- Concurrency counter incremented on `can_execute` and decremented on either `record_success` or `record_throttle`.
- Sleep-and-retry pattern in `proxy_request` (`:275`) — note: single retry only.

---

## job-service

### Purpose
Job lifecycle, backup triggers (single/bulk/datasource), restore/export/download orchestration, and DLQ controls. The largest service in the repo; serves as the API surface backing the operator UI's Jobs/Activity, Backup, Restore, and Export pages. See `job-service/main.py:1`.

### Endpoints
- `GET /health` (`:645`)
- `GET /api/v1/jobs` (`:741`) — paginated list.
- `GET /api/v1/jobs/{job_id}` (`:781`) — fetch one.
- `GET /api/v1/jobs/{job_id}/progress` (`:792`) — live progress with bulk rollup.
- `POST /api/v1/jobs/{job_id}/cancel` (`:939`) — cancel (204).
- `POST /api/v1/jobs/{job_id}/retry` (`:1422`)
- `GET /api/v1/jobs/{job_id}/logs` (`:1442`)
- `POST /api/v1/backups/trigger` (`:1517`) — single-resource backup.
- `POST /api/v1/backups/trigger-user/{resource_id}` (`:1642`) — per-user backup wrapper.
- `POST /api/v1/backups/trigger-bulk` (`:1643`) — multi-resource batch.
- `POST /api/v1/backups/trigger-datasource` (`:1767`) — "Backup all M365/Azure" datasource-level trigger.
- `POST /api/v1/jobs/restore` (`:1909`) — generic restore.
- `POST /api/v1/jobs/restore/mailbox` (`:1910`)
- `POST /api/v1/jobs/restore/onedrive` (`:1911`)
- `POST /api/v1/jobs/restore/sharepoint` (`:1912`)
- `POST /api/v1/jobs/restore/entra-object` (`:1913`)
- `GET /api/v1/jobs/restore/{job_id}/status` (`:2127`)
- `GET /api/v1/jobs/restore/history` (`:2137`)
- `POST /api/v1/jobs/export` (`:2145`)
- `POST /api/v1/resources/{resource_id}/export-or-restore` (`:2291`)
- `POST /api/v1/sharepoint/{resource_id}/download` (`:2382`) — server-side ZIP download.
- `GET /api/v1/jobs/export/{job_id}/status` (`:2470`)
- `GET /api/v1/jobs/export/{job_id}/download` (`:2480`)
- `GET /api/v1/dlq/stats` (`:2622`)
- `POST /api/v1/dlq/{dlq_name}/purge` (`:2631`)
- `POST /api/v1/dlq/{dlq_name}/requeue` (`:2632`)
- Plus chat-export sub-router (`/api/v1/exports/chat/*`) included via `from chat_export import router` (`:641`).

### Features
- `M365_RESOURCE_TYPES` list (`:53-100`) drives datasource-bulk fan-out.
- Azure workloads route to dedicated queues: `azure.vm`, `azure.sql`, `azure.postgres` (`:44-51`).
- Multi-priority backup queues: `backup.urgent` (priority 1), `backup.normal`, and Azure-specific routes.
- `_parse_uuid` (`:25`) translates malformed UUID strings to clean 400s instead of 500s.
- Batch deduplication via `shared.batch_pending.classify_scope`.
- Per-job bulk rollup `_job_rollup_bulk` (`:650`) computes live progress from `snapshots` table rather than the stale Job.progress_pct column.
- Tier-2 children excluded from list to avoid double-walking content (`:53-77`).
- Background tasks: backup DLQ consumer (`:1507`), reconciler (`:2354`), batch-stamp loop (`:2425`).
- Restore message dispatch with priority on restore queue (`:2091`, `:2236`).

### Env vars referenced
None directly in this file (uses `shared.config.settings`).

### External deps
- DB tables: `jobs`, `job_logs`, `resources`, `snapshots`, `snapshot_items`, `sla_policies`, `backup_batches`.
- Queues published: `backup.urgent`, `backup.normal`, `azure.vm`, `azure.sql`, `azure.postgres`, restore queues, `discovery.tier2`.
- Queues consumed: backup DLQs (`backup.urgent.dlq`, `backup.normal.dlq`, etc.).
- HTTP calls to sibling services (5s timeout, see `:1368`, `:2099`, `:2246`, `:2593`).

### Notable patterns
- Lifespan startup performs DB ping + `message_bus.connect` + `startup_router` (storage router); shutdown reverses (`:620-634`).
- Live progress rolls up from snapshots, not Job columns (avoids "stuck at 35%" bug, `:650-665`).
- `dedupedCount` annotation on response so UI can show "Scheduled M, N already in-flight" (`:610-617`).
- Multiple background `asyncio.create_task` loops launched during startup.

---

## progress-tracker

### Purpose
Real-time backup progress: per-resource bytes/items processed vs total, with in-memory cache (`progress_cache`) + DB persistence and SSE stream support. Port 8011. See `progress-tracker/main.py:1-10`.

### Endpoints
- `GET /health` (`:35`)
- `GET /api/v1/progress/resource/{resource_id}` (`:40`) — current progress for one resource.
- `GET /api/v1/progress/resources?tenant_id=…` (`:80`) — active (QUEUED/RUNNING) per resource.
- `GET /api/v1/progress/resource/{resource_id}/stream` (`:113`) — SSE with 2-second polling.
- `POST /api/v1/progress/update` (`:152`) — backup-worker calls this to push progress.
- `POST /api/v1/progress/estimate/{resource_id}` (`:209`) — pre-scan size estimate.

### Features
- Cached progress (`progress_cache`) keyed by `resource_id`.
- SSE event generator streams initial state, then polls DB every 2s; terminates on `COMPLETED`/`FAILED`/`CANCELLED`.
- Terminal-state guard: never downgrades a `COMPLETED`/`FAILED`/`CANCELLED` job back to `RUNNING` (`:199-202`).
- ETA computation based on elapsed-time vs progress_pct (`:288-295`).
- `_compute_resource_progress` derives percentage with bytes-first formula, items as fallback (`:281-284`).

### Env vars referenced
None.

### External deps
- DB tables: `jobs`, `resources`, `snapshots`.

### Notable patterns
- In-memory `progress_cache: Dict[str, dict]` shared across requests (only suitable for single-replica).
- `sse_subscribers: Dict[str, list]` declared but the poller doesn't actually use it for fan-out — each SSE connection independently polls DB.
- Estimate currently falls back to `Resource.storage_bytes`; the docstring at `:316` notes this is a placeholder for a future Graph-API pre-scan.

---

## report-service

### Purpose
Scheduled-report configuration, history, and ad-hoc generation. Sends reports via SMTP email and webhook (Slack/Teams/Google Chat). Port 8014. See `report-service/main.py:1-10`.

### Endpoints
- `GET /health` (`:508`)
- `GET /api/v1/reports/config` (`:513`) — get org's report config.
- `POST /api/v1/reports/config` (`:545`) — create.
- `PUT /api/v1/reports/config` (`:592`) — update.
- `GET /api/v1/reports/history` (`:644`) — paginated list.
- `GET /api/v1/reports/history/{report_id}` (`:690`) — single entry.
- `POST /api/v1/reports/send-test` (`:741`) — fire a test report.
- `POST /api/v1/reports/generate` (`:793`) — generate + send a real report (scheduler-driven).

### Features
- Pydantic schemas `ReportConfigCreate`/`Update`/`Response`, `ReportHistoryResponse`, `WebhookConfig`.
- Multi-channel destinations: email recipients, Slack webhooks, Teams webhooks (Google Chat referenced in docstring).
- SMTP configured from env on import (see env-vars list).
- Per-org config (one row per organization).
- "Send empty report" flag + empty-message override.

### Env vars referenced (file lines 43-48)
- `NOTIFICATION_EMAIL_ENABLED` (default `false`)
- `NOTIFICATION_EMAIL_SMTP_HOST` (default `smtp.office365.com`)
- `NOTIFICATION_EMAIL_SMTP_PORT` (default `587`)
- `NOTIFICATION_EMAIL_SMTP_USERNAME`
- `NOTIFICATION_EMAIL_SMTP_PASSWORD`
- `NOTIFICATION_EMAIL_FROM` (default `noreply@tm-vault.io`)

### External deps
- DB tables: `report_configs`, `report_history`, `jobs`, `resources`, `tenants`, `snapshots`.
- SMTP server (Office 365 by default).
- `httpx` for outbound webhooks.
- `shared.security.get_current_user_from_token`.
- `shared.storage_rollup.exclude_tier2_storage_dupes_clause`.

### Notable patterns
- Auth gated via `get_current_user_from_token` dependency (used on Depends-tagged routes).
- Two formats: empty report (one-liner) vs detailed report (`send_detailed_report` flag).

---

## resource-service

### Purpose
Resource catalog + SLA policy CRUD + resource-group management. Backbone for the Resources tab and the SLA assignment surface. See `resource-service/main.py:1`.

### Endpoints
- `GET /health` (`:497`)
- `GET /api/v1/resources` (`:504`) — paginated list with filter args.
- `GET /api/v1/resources/search` (`:782`)
- `GET /api/v1/resources/by-type` (`:806`) — tab-driven type-filtered listing (applies SharePoint name-collision exclusion).
- `GET /api/v1/resources/users` (`:1097`)
- `GET /api/v1/resources/{resource_id}` (`:1124`)
- `GET /api/v1/resources/{resource_id}/storage-history` (`:1140`)
- `POST /api/v1/resources/{resource_id}/assign-policy` (`:1151`)
- `POST /api/v1/resources/{resource_id}/unassign-policy` (`:1172`)
- `POST /api/v1/resources/{resource_id}/archive` (`:1185`)
- `POST /api/v1/resources/{resource_id}/unarchive` (`:1196`)
- `DELETE /api/v1/resources/{resource_id}` (`:1207`)
- `POST /api/v1/resources/bulk-assign-policy` (`:1218`)
- `POST /api/v1/resources/bulk-unassign-policy` (`:1313`)
- `GET /api/v1/policies` (`:1386`)
- `GET /api/v1/policies/{policy_id}` (`:1428`)
- `POST /api/v1/policies` (`:1438`)
- `PUT /api/v1/policies/{policy_id}` (`:1570`)
- `DELETE /api/v1/policies/{policy_id}` (`:1747`)
- `GET /api/v1/policies/{policy_id}/resources` (`:1761`)
- `POST /api/v1/policies/{policy_id}/auto-assign` (`:1769`)
- `POST /api/v1/policies/{policy_id}/force-reconcile` (`:1774`)
- `GET /api/v1/policies/{policy_id}/exclusions` (`:1819`)
- `POST /api/v1/policies/{policy_id}/exclusions` (`:1826`)
- `DELETE /api/v1/policies/{policy_id}/exclusions/{exclusion_id}` (`:1851`)
- `GET /api/v1/resource-groups` (`:1879`)
- `GET /api/v1/resource-groups/{group_id}` (`:1891`)
- `POST /api/v1/resource-groups` (`:1899`)
- `PUT /api/v1/resource-groups/{group_id}` (`:1924`)
- `DELETE /api/v1/resource-groups/{group_id}` (`:1985`)
- `POST /api/v1/resource-groups/{group_id}/policies` (`:1996`)
- `DELETE /api/v1/resource-groups/{group_id}/policies/{policy_id}` (`:2026`)

### Features
- `UI_HIDDEN_TYPES` exclusion (from `shared.models`) keeps redundant types out of tab listings.
- SharePoint-vs-group name-collision exclusion in `/by-type`.
- Bulk-assign / bulk-unassign with Tier-2 fan-out preparation for ENTRA_USERs.
- SLA immutability lock gate (`gate_immutability_lock` from `shared.sla_validation`).
- Policy validation via `validate_policy_payload`.
- Resource-group → multi-policy assignment via `GroupPolicyAssignment`.
- SLA exclusions (`SlaExclusion`).
- `byte_format` helper for human-readable sizes.

### Env vars referenced
None directly.

### External deps
- DB tables: `resources`, `sla_policies`, `tenants`, `sla_exclusions`, `resource_groups`, `group_policy_assignments`.
- HTTP to `backup-scheduler:8008/scheduler/reschedule-all` and `…/reconcile-lifecycle` (`:60`, `:117`).
- Queue published: `discovery.tier2` for Tier-2 fan-out preparation on SLA assignment (`:90`).
- `shared.sla_validation` for policy validation + immutability gating.

### Notable patterns
- Fire-and-forget notifier helpers `notify_scheduler_reschedule` / `notify_scheduler_lifecycle` (`:56`, `:115`).
- Tier-2 fan-out is `thenBackup=False` — SLA assignment is a "be ready" signal, not an immediate trigger (`:65-78`).
- Grouping discovery messages by tenant before publish for Graph-token cache efficiency.

---

## search-service

### Purpose
Full-text search across `snapshot_items` for emails, files, Teams messages, Entra ID metadata. Backed by Postgres GIN indexes on JSONB metadata and a `tsvector` `search_vector` column populated by an explicit reindex endpoint. Port 8013. See `search-service/main.py:1-9`.

### Endpoints
- `GET /health` (`:75`)
- `GET /api/v1/search?q=…` (`:80`) — paginated, filtered search.
- `GET /api/v1/search/suggestions?q=…` (`:190`) — top item-name matches.
- `POST /api/v1/search/reindex` (`:220`) — rebuild `search_vector` for snapshot IDs.

### Features
- Workload-type map (`workload_map`, `:118`): exchange/onedrive/sharepoint/teams/entra → item_type sets.
- Filters: `tenantId`, `workloadType`, `itemType`, `dateFrom`, `dateTo`.
- AND-of-OR text-search filters across `name` and JSONB-text (`:376`).
- `build_search_text` extracts workload-specific fields (subject/body/sender/recipients for EMAIL; body for TEAMS_MESSAGE; description for files; displayName/mail/jobTitle/department for ENTRA_*).
- HTML stripping + whitespace normalization on indexed text.
- `TEAMS_CHAT_MESSAGE` items hydrate body from `chat_thread_messages` table when `extra_data` is empty (Level 2 refactor compatibility, `:257-287`).

### Env vars referenced
None.

### External deps
- DB tables: `snapshot_items`, `snapshots`, `resources`, `tenants`, `chat_thread_messages`, `chat_threads`.
- Postgres GIN extension implicit via `CREATE INDEX IF NOT EXISTS`.

### Notable patterns
- Indexes created idempotently in startup `create_search_index` (`:46`).
- Best-effort indexer: per-item exception is logged and skipped (`:300`).
- Preview/snippet construction per workload type (`build_preview`, `:438`).
- Search results join 4 tables (item → snapshot → resource → tenant) for source attribution.

---

## snapshot-service

### Purpose
Snapshot + snapshot-item read API. Largest of the read-side services. Serves the Recovery / Browse Backups UI: lists snapshots per resource, browses items inside a snapshot per workload (emails / files / chats / contacts / calendar / Azure DB tables / VM volumes), streams item content, exports Azure DB CSVs, and supports VM-volume browsing. See `snapshot-service/main.py:1-7`.

### Endpoints
- `GET /health` (`:234`)
- `GET /api/v1/resources/{resource_id}/snapshots` (`:239`)
- `GET /api/v1/resources/{resource_id}/storage-summary` (`:376`)
- `GET /api/v1/resources/snapshots/folders` (`:472`)
- `GET /api/v1/resources/snapshots/{snapshot_id}` (`:599`)
- `GET /api/v1/resources/snapshots/{snapshot_id}/items` (`:687`)
- `GET /api/v1/resources/{resource_id}/snapshots/{snapshot_id}/items` (`:688` and `:740`)
- `GET /api/v1/resources/snapshots/{snapshot_id}/diff` (`:735`)
- `GET /api/v1/resources/with-backups` (`:790`)
- `GET /api/v1/resources/{resource_id}/content-snapshots` (`:944`)
- `GET /api/v1/resources/{resource_id}/snapshots/search` (`:1090`)
- `GET /api/v1/resources/snapshots/{snapshot_id}/items/{item_id}` (`:1189`)
- `GET /api/v1/resources/snapshots/{snapshot_id}/emails` (`:1362`) and `/mail` (`:1363`)
- `GET /api/v1/teams/hosted-content/{tenant_id}/{url_sha}` (`:1504`)
- `GET /api/v1/resources/snapshots/{snapshot_id}/messages` (`:1577`) and `/chats` (`:1578`)
- `GET /api/v1/resources/snapshots/{snapshot_id}/contact-folders` (`:1983`)
- `GET /api/v1/resources/snapshots/{snapshot_id}/chats/groups` (`:2013`)
- `GET /api/v1/resources/snapshots/{snapshot_id}/azure-db/export` (`:2086`)
- `GET /api/v1/resources/snapshots/{snapshot_id}/azure-db/table` (`:2262`)
- `GET /api/v1/resources/snapshots/{snapshot_id}/calendar` (`:2361`)
- `GET /api/v1/resources/snapshots/{snapshot_id}/onedrive` (`:2545`)
- `GET /api/v1/resources/snapshots/{snapshot_id}/onedrive/ids` (`:2625`)
- `GET /api/v1/resources/snapshots/{snapshot_id}/files` (`:2688`)
- `GET /api/v1/resources/snapshots/{snapshot_id}/contacts` (`:2724`)
- `GET /api/v1/resources/snapshots/{snapshot_id}/items/{item_id}/content` (`:2787`)
- `GET /api/v1/resources/snapshots/{snapshot_id}/items/{item_id}/attachments` (`:2938`)
- `POST /api/v1/snapshot-items/{item_id}/download-audit` (`:3062`)
- `GET /api/v1/snapshot-items/{item_id}/azure-vm-detail` (`:3165`)
- `GET /api/v1/snapshot-items/{item_id}/vm-volume-files` (`:3353`)
- `POST /api/v1/snapshot-items/{item_id}/vm-volume-download` (`:3620`)

### Features
- Per-workload listing endpoints (emails, chats, contacts, calendar, files/OneDrive, Azure DB tables, VM volumes).
- Folder tree extraction for OneDrive/SharePoint/Mail/contacts.
- Snapshot diff between two snapshots (added/removed/modified items).
- Snapshot-reuse helper from `shared.snapshot_reuse.resolve_snapshot_items_target` to follow re-used snapshots.
- Teams hosted-content URL resolver (`:1504`) for inline-image retrieval from `chat_url_cache`.
- Azure DB CSV export (`/azure-db/export`).
- VM volume browsing and file download.
- Power BI snapshot assembly via `shared.power_bi_snapshot.assemble_power_bi_items`.
- One-shot startup backfills: `folder_path` derivation from raw metadata (`:30-87`), chat-topic fallback cleanup (`:90`).
- Item content streaming via `StreamingResponse`.

### Env vars referenced
None directly.

### External deps
- DB tables: `snapshots`, `snapshot_items`, `resources`, `jobs`, `chat_thread_messages`, `chat_threads`, `chat_url_cache`.
- Azure Storage via `azure_storage_manager` (shards, workload mapping).
- `shared.snapshot_reuse`, `shared.power_bi_snapshot`, `shared.azure_storage`.

### Notable patterns
- Idempotent migration-style backfills run at startup (no separate Alembic step for these specific JSONB-derived columns).
- Per-workload SQL specialization (e.g. `parentReference.path` parsing for OneDrive items, `parentFolderId` for mail).
- Snapshot-reuse pattern lets a snapshot point at another snapshot's items without re-storing them (`resolve_snapshot_items_target`).

---

## storage_toggle_worker

### Purpose
Orchestrates `azure↔onprem` storage-backend toggles. Consumes the `storage.toggle` RabbitMQ queue. Uses a Postgres advisory lock so only one instance does the actual work — the other is a hot standby. See `storage_toggle_worker/main.py:1-7`.

### Endpoints
None — async worker, entry `asyncio.run(consume())` (`:127`).

### Features
- Postgres advisory-lock ID `9_042_042` (`:26`) — single-active-instance guarantee.
- Lock retry loop (15s) when held by another instance (`:77`).
- Fail-closed RabbitMQ connect: refuses to start on `guest:guest` defaults or missing creds (`:42-74`).
- Storage bootstrap (seed + NOTIFY triggers + seaweedfs bucket creation) at worker startup (`:98-103`).
- Delegates each message to `services.storage_toggle_worker.orchestrator.run_toggle`.

### Env vars referenced
- `DATABASE_URL` (overrides component vars) — `:31`.
- `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME` — fallback DSN composition (`:33-38`).
- `RABBITMQ_URL` (overrides component vars) — `:43`.
- `RABBITMQ_USERNAME` / `RABBITMQ_USER` — `:53`.
- `RABBITMQ_PASSWORD`, `RABBITMQ_HOST` — `:54-55`.
- `RABBITMQ_PORT` (default `5672`) — `:56`.

### External deps
- Postgres (via `asyncpg`) for advisory lock + bootstrap.
- RabbitMQ queue: `storage.toggle` (durable, declared on connect, `:110`).
- `shared.storage.router.router` for backend routing.
- `shared.storage_bootstrap.ensure_storage_bootstrap`.

### Notable patterns
- Advisory-lock hold for the lifetime of the consumer connection (no release until shutdown).
- Refuses `guest:guest` credentials explicitly (`:69-73`) — defaulting to the well-known RabbitMQ default would let any network-accessible process trigger toggles.

---

## tenant-service

### Purpose
Tenant + organization CRUD, discovery orchestration (M365 + Azure), per-user content discovery (Tier 2), DR config, and tenant-scoped secrets/usage. The "control plane" for adding/removing managed M365 + Azure subscriptions. See `tenant-service/main.py:1`.

### Endpoints
- `GET /health` (`:137`)
- `GET /api/v1/tenants` (`:142`)
- `GET /api/v1/tenants/{tenant_id}` (`:169`)
- `POST /api/v1/tenants` (`:185`)
- `PUT /api/v1/tenants/{tenant_id}` (`:223`)
- `PATCH /api/v1/tenants/{tenant_id}/dr-config` (`:244`)
- `GET /api/v1/tenants/{tenant_id}/dr-config` (`:301`)
- `DELETE /api/v1/tenants/{tenant_id}` (`:322`)
- `POST /api/v1/tenants/{tenant_id}/discover` (`:333`) and `/discover-m365` (`:334`)
- `POST /api/v1/tenants/{tenant_id}/discover-azure` (`:399`) — publishes to `discovery.azure`.
- `GET /api/v1/resources/{resource_id}/subsites` (`:431`) — live SharePoint subsites via Graph.
- `POST /api/v1/tenants/{tenant_id}/users/{user_resource_id}/discover-content` (`:476`) — Tier-2 discovery.
- `POST /api/v1/tenants/{tenant_id}/users/{user_resource_id}/backup` (`:520`)
- `GET /api/v1/tenants/{tenant_id}/discovery-status` (`:651`)
- `GET /api/v1/tenants/{tenant_id}/storage-summary` (`:668`)
- `POST /api/v1/tenants/{tenant_id}/test-connection` (`:674`)
- `GET /api/v1/organizations` (`:679`)
- `GET /api/v1/organizations/{org_id}` (`:696`)
- `GET /api/v1/tenants/{tenant_id}/info` (`:712`)
- `GET /api/v1/tenants/{tenant_id}/usage-report` (`:762`)
- `GET /api/v1/tenants/{tenant_id}/secrets` (`:894`)
- `POST /api/v1/tenants/{tenant_id}/secrets` (`:910`)
- `GET /api/v1/tenants/{tenant_id}/secrets/{secret_id}` (`:955`)
- `DELETE /api/v1/tenants/{tenant_id}/secrets/{secret_id}` (`:966`)
- `GET /api/v1/azure/tenants` (`:1126`)
- `GET /api/v1/azure/tenants/{tenant_id}/options` (`:1172`)

### Features
- `TYPE_MAP` from external Graph resource string to `ResourceType` enum (`:23-47`).
- M365 discovery via `GraphClient.discover_all` with idempotent upsert; emits singleton "Azure Active Directory" (`ENTRA_DIRECTORY`) row for each M365 tenant (`:93-…`).
- Azure discovery via queue (`discovery.azure`).
- Tier-2 per-user content discovery (Mail/OneDrive/Contacts/Calendar/Chats) using `shared.tier2_discovery.ensure_tier2_children`.
- SharePoint subsites resolved live via Graph (since backup-worker tracks delta but not display names).
- DR-config PATCH + GET (`/dr-config`).
- Per-tenant secrets CRUD.
- Multi-app Graph client sharding (`:347`) — comment notes >12 apps in QFION.
- Usage-report endpoint (`:762`).

### Env vars referenced
None directly.

### External deps
- DB tables: `tenants`, `organizations`, `resources`, `sla_policies`, `backup_batches`.
- Microsoft Graph via `shared.graph_client.GraphClient` (cached per tenant in some flows, `:380`).
- Queues published: `discovery.azure` (`:419`).
- `shared.tier2_discovery.ensure_tier2_children`.

### Notable patterns
- Per-tenant `GraphClient` cache to avoid re-instantiating on every loop (`:380-394`).
- Discovery upserts: existing rows have `display_name`/`email`/`extra_data` merged in place; new rows created with `ResourceStatus.DISCOVERED`.
- Lifespan starts `core_metrics.init` only (no message-bus connect at startup); message bus connected on demand inside the Azure discovery endpoint (`:414-416`).
- Multi-app manager — comments reference 12→20 Graph apps with per-mailbox in-flight scaling.

---

## Summary: endpoints per service

| Service | Endpoint count |
|---|---|
| alert-service | 20 |
| audit-service | 18 |
| auth-service | 16 |
| autoscaler | 0 (worker) |
| backup-scheduler | 5 |
| dashboard-service | 6 |
| delta-token | 6 |
| dr-replication-worker | 0 (worker) |
| graph-proxy | 6 |
| job-service | 25 |
| progress-tracker | 6 |
| report-service | 8 |
| resource-service | 31 |
| search-service | 4 |
| snapshot-service | 32 |
| storage_toggle_worker | 0 (worker) |
| tenant-service | 26 |
| **Total** | **209** |

Notes:
- Counts include `/health`. Workers (autoscaler, dr-replication-worker, storage_toggle_worker) have no FastAPI app — they run as asyncio loops.
- snapshot-service has two route decorators that resolve to the same path on lines 687/688 and 1362/1363 — the second of each pair is an alias.
- job-service additionally pulls in the chat-export router (`/api/v1/exports/chat/*`) which is defined in a separate `chat_export.py` module and not counted above.
