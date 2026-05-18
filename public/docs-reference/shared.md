# `tm_backend/shared/` — Module Reference

Domain-grouped reference for every module in `tm_backend/shared/`. Each entry gives a one-paragraph purpose and the top-level public symbols. Grounded in module docstrings and signatures.

---

## Microsoft Graph integration

### `graph_client.py`
The omnibus Microsoft Graph API client. Wraps OAuth token exchange, HTTP/2 connection pooling, rate-limit policy, app rotation, batch coordination, and per-call priority via a `ContextVar`. A single cached `GraphClient` is shared across concurrent jobs in a worker; each job sets its priority through the `graph_priority(...)` context manager, which `multi_app_manager` uses to elevate URGENT calls above NORMAL queue traffic at the per-app token bucket. Hosts discovery, restore, mail/OneDrive/SharePoint/Teams/Chats/Power-BI/Power-Platform/Planner/Todo endpoints and Entra (users, groups, CA, BitLocker, audit log, sign-in log) operations.
- `GraphClient` — main async client; methods include `discover_users / _groups / _mailboxes / _onedrive / _sharepoint / _teams / _power_platform / _planner / _todo / _all / _user_content / _conditional_access / _bitlocker_keys`, `batch(...)`, `download_drive_item_bytes`, `iter_sharepoint_*`, `get_chat_messages`, `get_all_chat_messages_for_user_delta`, `restore_entra_app`, `get_granted_scope_fingerprint`, `aclose`.
- `graph_priority(priority: int)` — context manager that pins all enclosed Graph calls to the given priority (0=NORMAL, 1=HIGH, 2=URGENT).
- `_parse_retry_after(resp, default, cap)` — parses `Retry-After` headers (seconds or HTTP-date) with a safety cap.
- Module cache `_MULTI_APP_CLIENT_CACHE` keyed by `(app_client_id, tenant_id)` to keep one long-lived HTTP/2 session per app.

### `graph_batch.py`
Wrapper around `/v1.0/$batch`. Bundles up to 20 non-paginated GET sub-requests into one HTTP call and retries 429 sub-responses honouring each sub's `Retry-After`. Rejects paginated endpoints (`/delta`, `$skiptoken`, `$top`) at submission time since `$batch` cannot follow `@odata.nextLink`. Two entry points: full `BatchClient` for production traffic and a thin `batch_requests(post, requests)` helper used by engines that stub out `_post` for tests.
- `BatchRequest` — dataclass for one sub-request (`id`, `method`, `url`, `headers`, `body`).
- `BatchResponse` — `(id, status, headers, body)` result row.
- `BatchClient(graph_client)` — production class; `validate_requests`, `execute(requests) -> List[BatchResponse]`.
- `batch_requests(post, requests) -> List[Dict]` — functional helper.

### `graph_entra.py`
Per-section Graph wrappers used by the `EntraRestoreEngine`. Each restorable Entra section (`USER`, `GROUP`, `ROLE`, `APPLICATION`, `SECURITY`, `ADMIN_UNIT`, `INTUNE`) owns a `SectionSpec` describing list/object/create URLs. Provides typed PATCH/POST helpers per section so the engine doesn't need to know Graph URL shapes, plus a `sieve_existence` batch existence check.
- `SectionSpec` (frozen dataclass), `SECTION_SPECS` (dict of all sections).
- `PATCH_FIELDS` / `MUTABLE_FIELDS` projections.
- `sieve_existence(...)`, `_project(...)`, `_random_password(length=20)`.
- Section helpers: `patch_user / create_user / patch_group / create_group / set_group_members / patch_admin_unit / create_admin_unit / set_admin_unit_members / patch_application / create_application / patch_ca_policy / create_ca_policy / patch_intune_policy / create_intune_policy / patch_role_definition / create_role_definition`.

### `graph_priority.py`
Priority scheduling for Graph calls. Maps RabbitMQ queue names to one of three priority levels so a single worker handling multiple queues can pass the right priority into every Graph call. Feature-flagged via `settings.GRAPH_PRIORITY_SCHEDULING_ENABLED`.
- Constants `PRIORITY_NORMAL=0`, `PRIORITY_HIGH=1`, `PRIORITY_URGENT=2`.
- Map `QUEUE_PRIORITY` (queue name → priority).
- `priority_for_queue(queue_name)` — lookup helper; unknown queues default to NORMAL.

### `graph_rate_limiter.py`
Process-global token-bucket limiter enforcing Microsoft's per-tenant Graph cap (~150k requests / 10 min sliding window). Sits *above* the per-app limiter in `multi_app_manager`. Pure-Python in-process by default; switches to Redis-coordinated mode when `REDIS_URL` is set (Lua script for atomic draws), and degrades safely back to process-local if Redis is unreachable.
- `_LocalTokenBucket` — async-safe Python bucket.
- `_RedisTokenBucket` — Redis-Lua bucket for multi-replica budgets.
- `GraphRateLimiter` — public wrapper; `await graph_rate_limiter.acquire()` blocks until a token is free. Config via `GRAPH_GLOBAL_RPS` / `GRAPH_GLOBAL_BURST` / `GRAPH_RATE_LIMITER_ENABLED`.

### `graph_ratelimit.py`
Central retry/backoff/pacing brain used by every `GraphClient`. One `RateLimitPolicy` instance per client decides how long to sleep after each 429/503 and when to give up so RabbitMQ's redeliver path can resume.
- `parse_retry_after(header_value)` — seconds-int OR HTTP-date.
- `jittered(base, ratio)` — uniform jitter helper.
- `BackoffWalker` — sleep-sequence walker with cumulative-cap tracking.
- `AsyncTokenBucket` — per-app token bucket (used by `multi_app_manager`).
- `PolicyAction` / `RateLimitPolicy` — decision engine.
- `GraphRetryExhaustedError` — raised when policy gives up.

### `_graph_retry.py`
Internal HTTP 429 / 5xx retry classifier shared across restore engines. Detects retryable errors structurally via the `response.status_code` attribute so it doesn't hard-couple to `httpx` types.
- `_is_retryable(exc) -> bool`.
- `_retry_after_seconds(exc) -> Optional[float]`.

### `multi_app_manager.py`
Distributes Graph requests across 12-20 app registrations to side-step per-app throttling. Each app has its own circuit breaker with HEALTHY → THROTTLED → PROBATION → HEALTHY state machine, escalating ban ladder, multiplicative-decrease/additive-increase adaptive rate, and a per-app token bucket. Selects the next app by least-loaded-of-admissible.
- `AppRegistry` — per-app health state (`is_throttled`, `in_probation`, `is_admissible`, `load_score`, `health`).
- `MultiAppManager` — `get_next_app()`, `get_app_by_client_id`, `mark_throttled`, `mark_success`, `reset_throttle`, `is_app_throttled`, `acquire_app_token`, `get_stats`.

### `tier2_discovery.py`
Single source of truth for materialising the five fixed USER_* child rows beneath each `ENTRA_USER` (`USER_MAIL`, `USER_ONEDRIVE`, `USER_CONTACTS`, `USER_CALENDAR`, `USER_CHATS`). Used by tenant-service ("Backup now"), job-service inline gap-fill, discovery-worker, and the 7h scheduler backstop. Idempotent — re-runs refresh in place rather than duplicating.
- `TIER2_CHILD_TYPES` tuple.
- `has_complete_tier2(db, user_resource_id) -> bool`.
- `ensure_tier2_children(db, user_resource, graph_client, *, commit=True) -> List[Resource]`.
- `find_users_missing_tier2(...)`.

---

## Storage layer

### `shared/storage/__init__.py`
Package façade re-exporting the public `BackendStore` / `BlobInfo` / `BlobProps` types. The storage abstraction is the single chokepoint through which every writer now goes; the router picks the backend by `system_config.active_backend_id` for writes and `snapshot_item.backend_id` for reads.

### `shared/storage/router.py`
`StorageRouter` — DB-driven backend registry. Loaded once at process startup; listens on Postgres channel `system_config_changed` for runtime backend swaps without restart. Holds a single long-lived asyncpg connection for both the LISTEN socket and periodic reload queries, serialised through an asyncio Lock to keep replica connection counts bounded.
- `PreflightCheck`, `PreflightResult` dataclasses.
- `StorageRouter` — `load(db_dsn)`, `close()`, `get_active_store()`, `get_store_by_id(backend_id)`, `get_store_for_item(item)`, `get_store_for_snapshot(snapshot)`, `writable()`, `active_backend_id`, `transition_state`, `list_backends()`.

### `shared/storage/base.py`
Protocol + DTOs every backend implementation must satisfy. Callers code against `BackendStore`, never an SDK directly.
- `BlobInfo` (post-upload result with `backend_id` to persist on `SnapshotItem`).
- `BlobProps` (returned by `get_properties`).
- `BackendStore` (`Protocol`) — `upload`, `upload_from_file`, `download`, `download_stream`, `stage_block`, `commit_blocks`, `put_block_from_url`, plus immutability, lifecycle, list/delete, presign.

### `shared/storage/azure_blob.py`
`AzureBlobStore` — adapter that fulfils `BackendStore` by delegating to the existing `AzureStorageShard` / `AzureStorageManager` code in `shared.azure_storage`. Semantics (SSC, multipart, WORM, lifecycle) unchanged.
- `AzureBlobStore.from_connection_string(...)`, `.from_config(backend_id, name, config)`, `.shard_for(tenant_id, resource_id)`.
- Standard `BackendStore` surface plus `server_side_copy`, `presigned_url`, `apply_immutability`, `apply_legal_hold`, `apply_lifecycle`, `ensure_container`, `close`.

### `shared/storage/seaweedfs.py`
`SeaweedStore` — S3-compatible backend over `aioboto3`. One bucket per shard; keys are path-prefixed `{container}/{path}`. Buckets MUST be created with `ObjectLockEnabledForBucket=True` plus versioning.
- `SeaweedStore.from_config(...)`, `shard_for(tenant_id, resource_id)`.
- Full `BackendStore` surface (`upload`, `upload_stream`, `upload_from_file`, `download`, `download_stream`, `stage_block`, `commit_blocks`, `server_side_copy`, `list_blobs`, `list_with_props`, `get_properties`, `delete`, `presigned_url`, `apply_immutability`, `apply_legal_hold`, `apply_lifecycle`, `ensure_container`, `close`).
- `_clean_metadata(metadata)` — header sanitiser.

### `shared/storage/errors.py`
Storage-layer exception hierarchy. `StorageError` base, `BackendUnreachableError` (network/DNS), `ImmutableBlobError` (WORM violation — expected during cleanup of locked snapshots), `TransitionInProgressError` (write during drain/flip), `BackendNotFoundError` (missing backend id).

### `shared/storage/startup.py`
Lifespan helpers each FastAPI service / worker calls at startup and shutdown to bring the `StorageRouter` up. Boot-race resilient: retries with exponential backoff while Postgres DNS / init scripts settle so workers don't end up in a "no router" zombie state that persists metadata without bytes.
- `_build_dsn()` — prefers `DATABASE_URL`, falls back to `DB_HOST/...`.
- `startup_router()` — load with retry.
- `shutdown_router()`.

### `azure_storage.py`
High-performance Azure Blob driver. Implements account-level sharding, sync+async clients, key-vault encryption-scope management, container-level WORM, legal holds, lifecycle policies, server-side copy with retry, and dedup-aware upload paths. The `AzureBlobStore` adapter delegates here.
- `AzureStorageShard` — single storage account; `from_connection_string`, sync+async client accessors.
- `_StoreFacade` — uniform write surface across shards.
- `AzureStorageManager` — top-level multi-shard manager.
- Helpers: `_sanitize_metadata`, `workload_candidates_for_resource_type`, `server_side_copy_with_retry`, `apply_lifecycle_policy`, `read_encryption_scope_state`, `resolve_key_vault_latest_version`, `apply_encryption_scope`, `read_container_immutability_state`, `apply_container_immutability`, `apply_container_legal_hold`, `apply_blob_immutability`, `apply_legal_hold`, `upload_blob_with_retry`, `upload_blob_with_retry_from_file`, `upload_blob_with_dedup`.

### `azure_provisioning.py`
Afi-style auto-provisioning of Azure SQL / PostgreSQL servers during discovery. Assigns our service principal as the Entra admin of each server so the azure-workload-worker can authenticate via AAD tokens for data-plane backup. Lives in `shared/` so every worker image can import it (previously duplicated under tenant-service, which broke discovery-worker).
- `ensure_sql_server_backup_ready(tenant, server, arm_token) -> bool`.
- `ensure_pg_server_backup_ready(tenant, server, arm_token) -> bool`.
- `_get_our_sp_object_id_in_tenant(tenant)`, `_get_graph_app_token(tenant)`.

### `azure_immutability.py`
Configures Azure Blob container immutability: time-based retention policies, legal holds, and version-level immutability for ransomware protection. Uses the Storage Management plane (`StorageManagementClient`) under AAD credentials.
- `AzureImmutabilityConfig` — `configure_container_immutability(...)`, legal-hold and version-level helpers.
- `get_immutability_config() -> Optional[AzureImmutabilityConfig]` — env-driven factory.

### `azure_region.py`
Lightweight region lookup split out from `azure_storage.py` so services that don't need the full blob SDK can resolve an account's region cheaply. Per-process TTL cache (1h) over ARM calls.
- `get_storage_account_region(account_name) -> Optional[str]`.
- `format_azure_region(region_code) -> Optional[str]` — code → display name.
- Constants `_AZURE_REGION_DISPLAY` (region code → display name).

### `azure_auth.py`
Afi-style Azure token management. Uses the admin's refresh token (delegated ARM access, ~90d lifetime) plus app credentials (Graph Directory.ReadWrite.All) to mint short-lived ARM access tokens before each operation. Marks the tenant `needs_reconsent` when the refresh token expires.
- `AzureAuthError` exception.
- `AzureTokenManager` — `get_arm_access_token(tenant)`, `get_graph_app_token(tenant)`, `get_sql_sp_credential()`, `_mark_reconsent_needed`.

### `blob_dedup.py`
Content-addressable dedup for blob uploads. At 5k users × 400 TiB, the same content (forwarded attachments, shared PDFs, screenshots) appears many times in a tenant; this helper checks whether `(tenant, content_hash)` is already backed by a blob and reuses its `blob_path` instead of uploading. Backed by the `(tenant_id, content_checksum)` PG index plus an in-process TTL-LRU layer (per-tenant key scope, 5 min TTL) for repeat lookups within a backup tick.
- `find_existing_blob(...)` — single lookup.
- `bulk_find_existing_blobs(...)` — chunked batch lookup (capped at `BLOB_DEDUP_BULK_CHUNK=500`).
- `invalidate_dedup_cache_entry(tenant_id, content_checksum)`.

### `storage_bootstrap.py`
Idempotent seeding of `storage_backends` + the `system_config` singleton + NOTIFY triggers. Runs from `init_db()` on every service startup so a fresh DB is self-healing. Installs the LISTEN/NOTIFY triggers on `system_config` and `storage_backends`, plus a backfill trigger that stamps `active_backend_id` onto legacy snapshot/snapshot_items inserts that omit it.
- `ensure_storage_bootstrap(engine)`.
- Helpers `_azure_config / _azure_endpoint / _seaweed_endpoint / _seaweed_buckets / _seaweed_config / _try_acquire_bootstrap_lock / _ensure_seaweed_buckets`.

### `storage_rollup.py`
Shared SQL filter that de-duplicates per-resource `storage_bytes` rollups. The backup pipeline writes bytes on both a Tier-1 row (`ONEDRIVE`/`MAILBOX`) and the matching Tier-2 child (`USER_ONEDRIVE`/`USER_MAIL`); a naïve `SUM` therefore double-counts. Tier-1 is canonical for drives + mailboxes; Tier-2 dupes are excluded. Also excludes children whose parent is an `ENTRA_USER` carrying the rollup.
- `exclude_tier2_storage_dupes_clause()` — SQLAlchemy WHERE clause used by every storage rollup query (dashboard, report, subtree lists).

---

## Message bus

### `message_bus.py`
Shared RabbitMQ bus for inter-service communication. `MessageBus` owns the robust connection, channel, and direct exchange `tm.exchange`; it declares every priority/partition queue at connect time. Default retry policy retries forever with capped exponential backoff so a brief RabbitMQ hiccup at boot doesn't permanently kill a service. Heartbeat is bumped to 1 week so hour-long backup jobs don't trigger consumer redelivery.
- `MessageBus` — `connect(max_retries=0, retry_delay=5)`, `disconnect()`, `publish(routing_key, message, priority=5)`, `consume(queue_name, callback)`, internal `_declare_queue`.
- Message builders: `create_backup_message`, `create_chats_partition_message`, `create_mail_partition_message`, `create_sharepoint_partition_message`, `create_groups_partition_message`, `create_entra_partition_message`, `create_onedrive_partition_message`, `create_mass_backup_message`, `create_restore_message`, `create_discovery_message`, `create_notification_message`, `create_audit_event_message`.

---

## Database / ORM

### `database.py`
SQLAlchemy async engine, session factory, and schema bootstrap. Pool sizing tuned for production backup workers (default 30+20) with a connection-budget comment block explaining how to size Postgres `max_connections` for the deployment. Implements an advisory-lock-guarded `init_db()` that creates the schema, seeds enums, runs storage bootstrap, and ensures preset SLA policies exist. Other services `wait_for_schema_ready` until the required table list is present.
- `Base(DeclarativeBase)`.
- `get_db()` — FastAPI dependency yielding `AsyncSession`.
- `init_db()` — idempotent schema bootstrap (advisory-locked, runs storage + preset seeds).
- `close_db()`.
- `wait_for_schema_ready(...)`, `_has_required_tables`, `_has_required_columns`, `_execute_batch`, `_ensure_enum_values`, `_seed_preset_policies_for_existing_tenants`.
- Constants: `REQUIRED_TABLES`, `SCHEMA_INIT_LOCK_ID`, `DDL_LOCK_TIMEOUT`, `DDL_STATEMENT_TIMEOUT`, `SCHEMA_READY_TIMEOUT_SECONDS`, `SEARCH_PATH`.

### `models.py` (reference only)
Single source of truth for the SQLAlchemy ORM models. ~50 classes covering organizations, tenants, platform users, roles, SLA policies, resources, jobs, snapshots, snapshot items, snapshot partitions, audit events, discovery runs, resource discovery staging, alerts, admin consent tokens, batch pending users, chat threads / messages, mail message bodies, OneDrive file retries, storage backends, system config, worker heartbeats, and more. Imported anywhere DB access happens.

### `schemas.py`
Shared Pydantic schemas (request/response DTOs) for every microservice. Covers auth (`UserResponse`, `LoginResponse`, `RefreshTokenRequest`, `RefreshTokenResponse`), Microsoft OAuth (`MicrosoftAuthUrlResponse`, `OAuthCallbackRequest`), datasource consent (`DatasourceConsentRequest`, `DatasourceCallbackResponse`), plus equivalents for organisations, tenants, SLA policies, jobs, snapshots, resources, alerts, audit events — all the cross-service wire shapes.

---

## Audit / observability

### `audit.py`
Fire-and-forget audit-event emitter. Every service / worker posts events the same way: `POST {AUDIT_SERVICE_URL}/api/v1/audit/log`. Replaces the previously-inlined ~12-line httpx block; transport errors are logged at WARNING and swallowed so a slow audit-service never masks the real workflow.
- `emit_audit_event(**fields)` — low-level POST.
- `emit_backup_triggered(...)` — typed helper for the backup-trigger event.
- `_audit_url`, `_resource_type`, `_resource_name` — internal shape helpers.

### `core_metrics.py`
Prometheus metrics for backup/restore/discovery hot paths + operational cost telemetry. Lazy-init / no-op fallback pattern: stays no-op if `prometheus_client` is missing. Runs on `CORE_METRICS_PORT` (default 9103, distinct from PST/SLA ports).
- `init(metrics_port=None) -> bool` — wire from each entry point.
- Observability: `inc_job`, `inc_snapshot`, `observe_backup_duration`, `inc_graph_call`, `observe_graph_call`, `inc_graph_throttle`, `inc_graph_rate_limit_wait`, `inc_discovery_504`, `add_backup_bytes`, `observe_storage_write`, `set_queue_depth`, `set_worker_active_jobs`, `set_pg_pool`, `set_worker_rss_mb`.
- Cost: `add_cost_storage`, `add_cost_egress`, `add_cost_compute`, `inc_cost_graph_call`, `add_cost_seaweed_write`, `add_cost_seaweed_read`.
- Context managers: `time_graph_call(endpoint, tenant)`, `time_storage_write(backend)`.

### `pst_metrics.py`
Prometheus metrics for the PST export pipeline. Mirrors `sla_metrics.py` lazy-init pattern; no-op when `prometheus_client` is missing. Scraped at `PST_METRICS_PORT` (default 9100). Metrics: `job_total`, `items_total`, `items_failed_total`, `job_duration_seconds`, `group_duration_seconds`, `attachment_skipped_total`, `worker_rss_mb`, `queue_active_jobs`.
- `init(metrics_port=None) -> bool`.
- `safe_inc(metric, *labels, amount=1.0)`, `safe_observe`, `safe_set`.

### `sla_metrics.py`
Prometheus metrics for the SLA-policy reconciler / sweeper / CMK paths. Lazy-init; scrapes at `SLA_METRICS_PORT` (default 9101).
- `init(metrics_port=None) -> bool`.
- `inc_reconcile(status)`, `inc_worm(mode)`, `inc_worm_loosen_refused()`, `inc_cmk_drift()`, `inc_cmk_rotated()`, `inc_encryption_transition(from, to)`, `inc_attempt_cap()`, `inc_audit_publish_failed()`, `set_dirty_count(n)`.

### `memory_monitor.py`
Polls process RSS and triggers a callback when the configured soft-limit percentage is exceeded for the grace period. Used by the mail-export orchestrator to perform a soft shutdown before Docker OOM-kills the worker mid-commit.
- `MemoryMonitor(limit_bytes, soft_limit_pct, grace_seconds, poll_interval_seconds, on_breach)` — `start()`, `stop()`.

---

## Backup-flow helpers

### `backup_checkpoint.py`
Per-job backup checkpoint stored on `Job.result.backup_checkpoint`. Records the resume delta token plus a set of completed file external IDs and counts; commit cadence is "N files OR M bytes since last commit, whichever first". On redelivery, file metadata is filtered through `is_done(...)` so completed files are never re-downloaded.
- `BackupCheckpoint` dataclass — `empty(resource_id, drive_id)`, `from_dict(payload)`, `to_dict()`, `is_done(ext_id)`, `record_file_done(...)`, `should_commit(...)`, `mark_committed()`.

### `backup_cleanup.py`
Deletes partial-backup artifacts when a job is cancelled. Streams over every IN_PROGRESS/COMPLETED snapshot for the job, deletes each snapshot_item's blob via the storage abstraction, deletes attachment blobs referenced by `extra_data.attachment_blob_paths`, deletes the snapshot_items rows, then marks the snapshot CANCELLED. Idempotent; per-blob errors are logged + counted rather than aborting the run.
- `cleanup_cancelled_snapshots(*, job_id, session_factory, shard, container_resolver, delete_db_rows=True, batch_size=500) -> Dict[str, int]`.
- `default_container_resolver(item) -> str`.

### `batch_pending.py`
Pure-Python state machine + scope classification for the "Backup all" batch flow. Imports are free (no IO). Splits a batch's scoped user IDs into `ready` (have Tier-2 children, enqueue immediately) and `deferred` (no Tier-2, chain a discovery first).
- `BatchPendingState` constants `WAITING_DISCOVERY / BACKUP_ENQUEUED / NO_CONTENT / DISCOVERY_FAILED`, plus `is_terminal(state)`.
- `classify_scope(scope, tier2_owners) -> (ready, deferred)`.

### `batch_rollup.py`
Pure-function + SQL-builder helpers for the Activity Manager batch rollup. Aggregates three state sources (Jobs, Snapshots, snapshot_partitions) into a single per-batch row and decides when the batch is "Done". Weights Tier-1 vs Tier-2 progress (10/90) because Tier-1 is metadata-only while Tier-2 carries the actual data bytes.
- `RollupCounts` dataclass.
- `derive_batch_status(counts) -> str`.
- `build_batch_rollup_query(...)` — SQL builder.
- `shape_batch_row(row) -> Dict`.
- `_finalize_batch_if_complete(batch_id, session)`.
- Helpers `_format_details`, `_fmt_bytes`.

### `lease.py`
Atomic lease claim + renewal with fence tokens. A *lease* is `(lease_owner_id, lease_expires_at, lease_token)` on every work row (`jobs`, `snapshots`, `snapshot_partitions`). The fence token is a monotonic counter; every state UPDATE the worker issues carries `WHERE lease_token = :my_token` so a worker whose lease was re-taken writes zero rows and aborts cleanly. TTL=600s, renew at TTL/5 by default.
- `Lease` dataclass — `fence_clause()`, `fence_params()`.
- `claim(...)`, `renew(...)`, `release(...)`.
- `LeaseRenewer` (background task that renews on a tick).
- `LeaseExtender` (manual extension).
- `new_owner_uuid()`.

### `reclaim.py`
Startup reclaim. Called once per worker boot before consuming starts. Finds work rows whose `lease_owner_id` matches our previous `worker_uuid` (from `worker_heartbeats`) and clears the lease plus bumps the fence token. Tombstones the old heartbeat so the sweeper doesn't see two live workers. Closes the redeploy gap to <1s instead of waiting `LEASE_TTL_S + sweep_interval`.
- `reclaim_for_replica(*, replica_id, worker_uuid) -> int`.

### `reconciler.py`
Reconciler sweep — bottom-up orphan finalisation. Runs every ~60s in backup-scheduler; walks partitions → snapshots → jobs and finalises any row stuck non-terminal whose lease is dead and whose children are all terminal. Bottom-up ordering prevents a parent from finalising before a still-pending child. `RECONCILER_PART_STALE_MIN=15` minutes (tuned up from 5 to avoid bumping requeue counts on partitions still queued in RMQ).
- `SweepStats` dataclass.
- `sweep_orphans(session) -> SweepStats`.
- `republish_partition_messages(...)`.
- `_queue_for_partition_type`, `_message_type_for_partition_type`.

### `retention.py`
Tiny pure-helper module translating SLA-policy retention settings into the two values every backend needs when applying WORM locks: an absolute `retention_until` datetime and a mode string (`Locked`/`COMPLIANCE` vs `Unlocked`/`GOVERNANCE`).
- `compute_retention_until(sla_policy, created_at) -> datetime`.
- `compute_immutability_mode(sla_policy) -> str` (`'Locked'` or `'Unlocked'`).

### `retention_cleanup.py`
Daily snapshot retention enforcement, invoked from backup-scheduler. Implements FLAT, GFS, ITEM_LEVEL, HYBRID retention modes plus archived-resource modes (`SAME / KEEP_ALL / KEEP_LAST / CUSTOM`). Honours legal hold and `immutability_mode='Locked'` (skip pruning). Idempotent. Includes a snapshot-reuse-aware rehydrate step that promotes the next reuse child into a full snapshot before deleting its parent.
- `enforce_retention_for_tenant(session, tenant_id) -> Dict[str, int]`.
- `enforce_retention_all_tenants(session_factory) -> Dict[str, Dict[str, int]]`.
- Internal: `_is_archived`, `_archived_keep_ids`, `_is_on_hold`, `_flat_keep_ids`, `_gfs_keep_ids`, `_delete_snapshots`, `_rehydrate_reuse_heir`.

### `snapshot_reuse.py`
Snapshot-reuse chain helpers. A "reuse" snapshot owns no `snapshot_items` rows; it points (via `reuse_of_snapshot_id`) at the previous stable snapshot of the same resource and (via `reuse_chain_root_id`) at the terminal full snapshot whose rows represent the inventory. Every reader of `snapshot_items` must resolve through these helpers first so the chain is transparent.
- `SnapshotNotFound` exception.
- `SnapshotReuseInfo` dataclass.
- `resolve_snapshot_items_target(session, snapshot_id) -> SnapshotReuseInfo` (one indexed PK lookup, denormalised root).
- `resolve_many(session, snapshot_ids)`.
- `_measure_chain_depth(...)`, `_coerce_uuid(...)`.

### `heartbeat.py`
Worker liveness signal. Each worker spawns a single `HeartbeatThread` after AMQP connect and before consume; the thread UPSERTs `worker_heartbeats` every `HEARTBEAT_INTERVAL_S` seconds. The reconciler reads those rows to decide whether a held lease belongs to a live worker. SIGTERM tombstones the row by writing `last_seen_at = NOW() - INTERVAL '1 hour'` so the sweeper kicks in immediately.
- `HeartbeatThread(worker_id, service_name, queues=(), version=None, interval_s=HEARTBEAT_INTERVAL_S)` — `start`, `stop`, internal UPSERT loop.
- `_resolve_replica_id()` — `RAILWAY_REPLICA_ID` / `HOSTNAME` / `POD_NAME` / random UUID.

---

## Routing / dispatch

### `export_routing.py`
Queue selectors for backup / restore / export jobs. Heavy resource types (OneDrive / SharePoint / Power BI) always route to the dedicated `backup.heavy` pool regardless of byte estimate so a single 80 GB OneDrive doesn't starve regular MAILBOX / ENTRA / USER_* work. Export uses a byte-threshold gate.
- `pick_export_queue(total_bytes=0, include_attachments=True) -> str`.
- `pick_backup_queue(*, drive_bytes_estimate=0, resource_type, default_queue=None) -> str`.
- `pick_restore_queue(total_bytes) -> str`.

### `routing_fence.py`
Layer-4 of the reconciliation design: defends against wrong-queue delivery. Every work message gets wrapped with `{expected_workload, route_hops, payload}`; on mismatch the worker re-publishes to the correct queue (up to 2 hops) and then DLQs into `work_dead_letter` to stop ping-pong. Feature-flagged via `ROUTING_FENCE_ENABLED`.
- `_QUEUE_BY_WORKLOAD` workload → queue mirror.
- `wrap_outgoing(payload, *, expected_workload) -> Dict`.
- `unwrap_incoming(...)`.
- `correct_queue_for(expected_workload) -> Optional[str]`.
- `reroute_or_dlq(...)`.

### `folder_resolver.py`
Single-query resolver for the file-selection model used by restore / export. The frontend sends a tuple of `item_ids` (individually ticked), `folder_paths` (ticked folders — every descendant), and `excluded_item_ids` (un-ticked inside ticked folders); this module expands those into the concrete `SnapshotItem` rows in one indexed SQL round trip. Strict: empty inputs return empty.
- `resolve_selection(session, snapshot_id, item_ids, folder_paths, excluded_item_ids) -> List[SnapshotItem]`.
- Internal: `_to_uuids`, `_prefix_and_exact_for`.

### `resource_group_matcher.py`
Resource-group rule evaluator. Given a resource (dict from discovery OR ORM Resource) and a set of `ResourceGroup` rows, decides which groups match. Used by the discovery-worker to auto-assign SLA policies via `GroupPolicyAssignment`. Rules support fields (`NAME / EMAIL / DEPARTMENT / CITY / COUNTRY / JOB_TITLE / RESOURCE_TYPE / EXTERNAL_ID / TAG_VALUE`), operators (`EQUALS / NOT_EQUALS / CONTAINS / NOT_CONTAINS / STARTS_WITH / ENDS_WITH / IN`), and AND/OR combinator.
- `resource_matches_group(resource, rules, combinator) -> bool`.
- `find_matching_groups(...)`.
- Internal: `_get_field`, `_apply_operator`.

---

## Security

### `security.py`
Shared security primitives — JWT issue/decode, secret encryption, refresh-token revocation. Uses Fernet for at-rest secret encryption (`ENCRYPTION_KEY` must be distinct from `JWT_SECRET`; sharing one means a single env leak unlocks every stored secret). `_HTTPBearer401` subclass returns 401 (not the default 403) on missing/malformed bearer so the SPA's auto-refresh path works.
- `security` — FastAPI dependency (`_HTTPBearer401()`).
- `encrypt_secret(plaintext) -> bytes`, `decrypt_secret(ciphertext) -> str`.
- `create_access_token(data, expires_delta=None) -> str`.
- `create_refresh_token(data) -> str`.
- `decode_token(token, expected_type='access') -> dict`.
- `revoke_refresh_token(jti, ttl_seconds)`, `is_refresh_token_revoked(jti) -> bool`.
- Internal: `_get_fernet`, `_get_revocation_redis`, `_unauthorized`, `_get_user_from_token`.

### `entra_fingerprint.py`
Fingerprint helper for Entra snapshot items. Computes a stable hash over an item's mutable fields at backup time so the restore engine can detect `unchanged | updated` against a live Graph fetch in O(1). Volatile fields (server-managed timestamps, `@odata.etag`, etc.) are explicitly excluded so a benign read never reports drift.
- `_ALWAYS_IGNORE` frozenset of volatile fields.
- `MUTABLE_FIELDS` dict — per-item-type allowlists (`ENTRA_DIR_USER`, `_GROUP`, `_ROLE`, `_APPLICATION`, `_SECURITY`, `_ADMIN_UNIT`, `_INTUNE`).
- `fingerprint_object(item_type, raw) -> str`.

---

## Misc helpers

### `aspose_license.py`
Deprecated no-op shim. The PST export pipeline migrated off Aspose.Email to the bundled `pst_convert` CLI (see `pstwriter_cli.py`). Kept so any out-of-tree caller still importing `apply_license` keeps loading; emits `DeprecationWarning`.
- `apply_license() -> None`.
- `reset_for_testing() -> None`.

### `asyncio_handlers.py`
Process-wide asyncio exception handler. aio-pika and azure-storage's aiohttp transport surface transient connector-cleanup exceptions as "Future exception was never retrieved" warnings — cosmetic noise that's already handled by the library's own retry. This handler downgrades known transient broker / HTTP-transport exceptions to a single-line DEBUG log and lets every other exception fall through to the default loud handler. Wire from every long-running worker right before `asyncio.run`.
- `install_robust_loop_handler() -> None`.
- Internal: `_is_transient_http_transport`, `_handle`.
- Sets `_TRANSIENT_BROKER_EXC`, `_TRANSIENT_HTTP_TRANSPORT_EXC`, `_TRANSIENT_HTTP_MSG_PATTERNS`.

### `config.py`
Single `Settings` object aggregating every env-var-backed config knob across services. Parses `DATABASE_URL` or `DB_HOST/PORT/USER/PASSWORD/NAME`; defines pool sizes (30+20 by default for backup workers), JWT/encryption secrets, Microsoft/Power-BI/Power-Platform credentials, RabbitMQ URL + queue names, Azure storage endpoint, Graph throttling knobs (per-app, per-tenant, priority), backup/restore heavy queues, discovery cadences, and feature flags. Imported by every other shared module.
- `Settings` — single class instantiated as `settings` (module-level singleton).

### `export_manifest.py`
Accumulates per-item success/failure rows during a mail export and emits `_MANIFEST.json` at the end of the ZIP — required for the eDiscovery audit trail. Thread-safe with an internal lock so concurrent worker threads can record results.
- `ExportManifestBuilder(job_id, snapshot_ids)` — `record_success`, `record_failure`, `exported_count`, `failed_count`, `to_json()`.

### `file_path_sanitize.py`
Windows-safe ZIP arcname helpers. OneDrive file/folder names include characters forbidden on Windows (`< > : " / \ | ? *`), paths that exceed the 260-char cap, and sometimes collide after sanitisation (two files in one folder both renamed `_______.docx`). These helpers make arcnames safe to extract everywhere without losing uniqueness — truncation appends a SHA-1 prefix; collisions get an `~<external_id[:8]>` tag before the extension.
- `sanitize_arcname(raw_path, *, max_len, replace_chars) -> str`.
- `resolve_arcname_collision(arcname, *, external_id, used) -> str`.

### `mbox_writer.py`
mboxrd writer with From-line escaping + size-based rollover. mboxrd (RFC 976 variant) is the widest-compat flavour — Thunderbird, Apple Mail, Aid4Mail, mbox-utils all accept it. Streams bytes to a caller-supplied `emit` callback in chunks; fires `on_rollover(new_index)` when cumulative size exceeds `split_bytes`.
- `MboxWriter(emit, split_bytes, on_rollover=None)` — `append_message(eml_bytes, sender_addr, sent_at_epoch)`.
- Internal: `_escape_from_lines(body)`, `_format_from_separator(sender_addr, sent_at_epoch)`.

### `metadata_extractor.py`
Structured metadata extraction for backup items. Normalises Graph API responses — permissions, relationships, thread structure, system event details (call started/ended, member adds/removes, chat renames, app installs) — into the consistent shapes our restore engines expect. Handles the variability in Graph's initiator/member shapes (`{user:{...}}` vs flat).
- `MetadataExtractor` — main class with extractors for permissions, members, replies, threading, event details.
- Internal helpers: `_map_event_kind`, `_extract_user`, `_build_event_detail`.

### `mime_builder.py`
Builds RFC 5322 MIME multipart EML bytes from a Graph API message dict. Used by the mail-export pipeline in restore-worker to produce standards-compliant `.eml` files that Outlook, Thunderbird, Apple Mail, and eDiscovery tooling parse losslessly. Supports both in-memory attachments (tests/small) and streaming attachments from Azure blob (production).
- `AttachmentRef` dataclass — `name`, `content_type`, `data_bytes` or `data_stream`.
- `build_eml(graph_msg, attachments) -> bytes` — in-memory.
- `build_eml_streaming(...)` — async streaming variant.
- Internal: `_format_addr`, `_format_addr_list`, `_parse_date`.

### `sla_presets.py`
Seeds the four default SLA policies (Gold / Silver / Bronze / Manual) on tenant creation, mirroring afi.ai's default tiering. M365 tenants and Azure tenants get different preset shapes (Azure tenants don't need Exchange/OneDrive toggles, M365 tenants don't run VM/SQL). Called from auth-service after tenant flush; idempotent on `name + tenant`.
- `seed_preset_policies(db, tenant_id, tenant_type) -> int`.
- Internal: `_m365_presets(tenant_id)`, `_azure_presets(tenant_id)`.

### `sla_validation.py`
Pure SLA-policy validation + the WORM-Lock gate. No FastAPI app, no SQLAlchemy session, no logging side-effects on import — both the API layer and the unit-test suite import these directly. The lock gate hard-blocks transitions to `immutability_mode='Locked'` unless the request includes both `confirmImmutabilityLock=True` AND a typed name that matches the policy's current name (two independent confirmations, because Locked Azure container policies cannot be reversed).
- `gate_immutability_lock(request, prior_mode=None, current_name=None) -> None`.
- `validate_policy_payload(request) -> None`.
- Constants `_MAX_DAYS`, `_VALID_RETENTION_MODES`, `_VALID_ARCHIVED_MODES`, `_VALID_IMMUTABILITY`, `_VALID_ENCRYPTION`.

### `power_bi_client.py`
Power BI / Fabric client for discovery, backup, and restore. Supports both app-only client-credentials auth (`POWER_BI_SCOPE` / `FABRIC_SCOPE`) and delegated service-user auth (refresh token; needed for tenant-scope scan + dataset/dataflow operations Microsoft restricts from app-only). Talks both the Power BI v1.0 API (`api.powerbi.com`) and the Fabric API (`api.fabric.microsoft.com`).
- `PowerBIClient(tenant_id, client_id=None, client_secret=None, refresh_token=None)` — `auth_mode`, `list_workspaces`, `list_modified_workspace_ids`, `scan_workspaces`, `list_reports_in_group`, `list_dashboards_in_group`, `list_tiles_in_group`, `list_datasets_in_group`, `list_dataflows_in_group`, `list_fabric_items`, `get_dataset_datasources`, `get_dataset_refresh_schedule`, `get_item_definition`, `create_item`, `update_item_definition`, `rebind_report_in_group`, etc.
- Static helpers: `get_refresh_token_from_tenant`, `encode_refresh_token`, `persist_refresh_token`.

### `power_bi_snapshot.py`
Helpers for Power BI snapshot chaining and incremental assembly. Decides whether the next snapshot should be a full re-scan or an incremental delta over the previous full (forces full when no previous full, when last full is >7 days old, when strategy version changed, or when the base reference is missing). Assembles a tenant's Power BI item view across a chain of snapshots up to `up_to_snapshot_id`.
- `SnapshotLike` frozen dataclass.
- `POWER_BI_INCREMENTAL_STRATEGY_VERSION` constant.
- `build_power_bi_item_key(item_type, external_id) -> str`.
- `should_force_power_bi_full_snapshot(latest_full_created_at, latest_snapshot_extra, now=None, max_age_days=7, strategy_version=...) -> (bool, reason)`.
- `assemble_power_bi_items(snapshots, items, up_to_snapshot_id=None) -> List`.

### `power_platform_client.py`
Power Platform Admin API client covering Power Apps, Power Automate (Flows), and Power Platform DLP policies. App-only client credentials with a Power Platform-scoped token (audience `https://service.powerapps.com` — NOT Graph). The app registration needs the Power Platform Administrator role on the tenant.
- `PowerPlatformClient(client_id, client_secret, tenant_id)` — methods for environments, apps, flows, connections, connectors, DLP policies via BAP / Flow / Power Apps endpoints.

### `pstwriter_cli.py`
Async wrapper around the bundled `pst_convert` CLI (built from `vendor/pstwriter`). Replaces the old Aspose.Email-based writer. The restore-worker Docker image bakes the binary at `/usr/local/bin/pst_convert`; overridable via `PSTWRITER_CLI` env so local dev can point at a Windows build. Accepts mail / contacts / calendar input as a single Graph object, bare array, or `{"value": [...]}` envelope (always emits the envelope form).
- `PstWriterCliError(RuntimeError)` — carries `returncode`, `stderr`, `stdout`.
- `convert_to_pst(kind, items, output_path, timeout_s=...)` — async invocation.
- `cli_available() -> bool` — feature probe.
- `_resolve_binary() -> str` — env / PATH / baked-in resolution.
- `_VALID_KINDS = {"mail", "contacts", "calendar"}`.
