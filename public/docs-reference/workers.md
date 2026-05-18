# TMvault Backend Workers

Documentation of every worker under `tm_backend/workers/`. Citations are file:line. Sourced strictly from code.

---

## backup-worker

### 1. Purpose

`workers/backup-worker/main.py:1-18` — "High-Performance Backup Worker - Mass Backup Processing". Per the module docstring, it provides Server-Side Copy for OneDrive/SharePoint, storage sharding across multiple Azure Storage Accounts, workload + user-level parallelism, delta-token tracking for incremental backups, adaptive throttling with exponential backoff, content dedup via SHA-256, and versioned blob paths for retention.

Top-of-file utilities cover fast JSON (`orjson` with `json` fallback, line 35-44), fast hashing (`blake3` for per-item integrity hashes; SHA-256 stays for the cross-snapshot dedup index, line 59-68), and inline-attachment threshold logic — attachments / chat hosted-contents below `INLINE_ATTACHMENT_MAX_BYTES` (default 256 KB) are base64'd into `snapshot_items.extra_data["inline_b64"]` to dodge Azure block-list commit latency (line 78-111).

The 22k-line file is essentially `BackupWorker` (line 1952) plus its per-resource-type handlers, partition coordinators / consumers, and a battery of dedup, delta and reconciliation helpers.

### 2. Queues consumed

Wired in `start()` at `workers/backup-worker/main.py:2048-2200`. Per-queue *channels* are opened in `consume_queue()` so each `set_qos(prefetch_count=N)` actually scopes to that consumer (line 2266-2280; older shared-channel code silently capped every queue to the last `set_qos` call).

Dedicated-only mode (default true when this replica IS the heavy pool — `BACKUP_WORKER_QUEUE == BACKUP_HEAVY_QUEUE`, env `BACKUP_WORKER_DEDICATED_ONLY` overrides) consumes ONLY one queue (line 2084-2097):

| Queue | Default prefetch | Env override | Purpose |
| --- | --- | --- | --- |
| `backup.urgent` | 8 | `BACKUP_URGENT_PREFETCH` | Manual user-triggered backups |
| `backup.high` | 10 | `BACKUP_HIGH_PREFETCH` | Scheduled bulk triggers |
| `<BACKUP_WORKER_QUEUE>` (e.g. `backup.normal` / `backup.heavy`) | 20 | `BACKUP_NORMAL_PREFETCH` | Per-replica dedicated lane |
| `backup.low` | 50 | `BACKUP_LOW_PREFETCH` | Retention sweeps |
| `backup.onedrive_partition` | 2 | — | OneDrive partition shards (`ONEDRIVE_PARTITION_ENABLED`) |
| `backup.chats_partition` | 12 | `BACKUP_CHATS_PARTITION_PREFETCH` | USER_CHATS partition shards (`CHATS_PARTITION_ENABLED`) |
| `backup.mail_partition` | 4 | `BACKUP_MAIL_PARTITION_PREFETCH` | Mail folder partition shards (`MAIL_PARTITION_ENABLED`) |
| `backup.sharepoint_partition` | 2 | `BACKUP_SP_PARTITION_PREFETCH` | SP drive partition shards (`SP_PARTITION_ENABLED`) |
| `backup.groups_partition` | 4 | `BACKUP_GROUPS_PARTITION_PREFETCH` | Teams channel partition shards (`GROUPS_PARTITION_ENABLED`) |
| `backup.entra_partition` | 4 | `BACKUP_ENTRA_PARTITION_PREFETCH` | Entra directory category shards (`ENTRA_PARTITION_ENABLED`) |

Per-queue priority for the Graph rate limiter is resolved via `shared.graph_priority.priority_for_queue(queue_name)` (line 2293) and held via the `graph_priority` ContextVar (line 2322) for the duration of the handler.

Also started:

- An OneDrive per-file retry consumer loop (`_onedrive_retry_consumer_loop()`) when `ONEDRIVE_RETRY_QUEUE_ENABLED=true` (line 2192).

### 3. Message types handled

Dispatch is in `process_backup_message()` (line 2739-2823) and `_HANDLER_TABLE` (line 2829-2864):

Partition envelopes — handled before generic dispatch:

- `BACKUP_ONEDRIVE_PARTITION` → `_process_onedrive_partition_message` (line 2746, 11201)
- `BACKUP_CHATS_PARTITION` → `_process_chats_partition_message` (line 2758, 11469)
- `BACKUP_MAIL_PARTITION` → `_process_mail_partition_message` (line 2764, 11737)
- `BACKUP_SHAREPOINT_PARTITION` → `_process_sharepoint_partition_message` (line 2771)
- `BACKUP_GROUPS_PARTITION` → `_process_groups_partition_message` (line 2778)
- `BACKUP_ENTRA_PARTITION` → `_process_entra_partition_message` (line 2785)

Standard backup envelope: requires `jobId` (line 2803); routes by presence of `resourceIds` (mass → `_process_mass_backup`) vs `resourceId` (single → `_process_single_backup`).

Resource-type handler table (line 2829-2864) — the resource's `type` selects the handler:

| Resource type(s) | Handler |
| --- | --- |
| `MAILBOX`, `SHARED_MAILBOX`, `ROOM_MAILBOX` | `backup_mailbox` |
| `ONEDRIVE` | `backup_onedrive` |
| `SHAREPOINT_SITE` | `backup_sharepoint` |
| `TEAMS_CHANNEL` | `backup_teams_single` |
| `TEAMS_CHAT` | `backup_teams_chat_single` (legacy drain) |
| `TEAMS_CHAT_EXPORT` | `backup_teams_chat_export` |
| `ENTRA_USER`, `ENTRA_GROUP`, `M365_GROUP`, `ENTRA_APP`, `ENTRA_DEVICE`, `ENTRA_SERVICE_PRINCIPAL` | `backup_entra_single` |
| `ENTRA_DIRECTORY` | `backup_entra_directory` |
| `ENTRA_CONDITIONAL_ACCESS` | `backup_conditional_access` |
| `ENTRA_BITLOCKER_KEY` | `backup_bitlocker_key` |
| `PLANNER`, `TODO`, `ONENOTE`, `COPILOT`, `POWER_APPS`, `POWER_AUTOMATE`, `POWER_DLP`, `RESOURCE_GROUP`, `DYNAMIC_GROUP` | `_backup_metadata_only` |
| `POWER_BI` | `backup_power_bi_workspace` |
| `USER_MAIL`, `USER_ONEDRIVE`, `USER_CONTACTS`, `USER_CALENDAR`, `USER_CHATS` (Tier-2) | `_backup_user_content_single` (wraps `_backup_user_content_parallel`, line 3717) |

`_backup_user_content_parallel` switches on the per-user content `kind`: `USER_MAIL` (line 3763), `USER_ONEDRIVE` (line 4455), `USER_CONTACTS` (line 4590), `USER_CALENDAR` (line 4640), `USER_CHATS` (line 4828).

Malformed messages: missing `jobId` and no recognised `messageType` raises `PoisonMessageError` (defined at line 214) which is routed straight to DLQ via `message.reject(requeue=False)` (line 2325-2336), so a single bad payload can never pin a consumer.

### 4. Processing flow (claim / process / ack)

`consume_queue` (line 2262-2404) is the heart. Concurrent-handler refactor (line 2296-2367) dispatches each delivery to its own `asyncio.Task`; a semaphore equal to `prefetch_count` caps in-flight work so the iterator naturally pauses when full and aio-pika's broker-side prefetch matches the in-process budget exactly.

Inside `_handle_one`:

1. Decode JSON body.
2. Run `process_backup_message` inside the queue's `graph_priority(...)` context.
3. `message.ack()` on success.
4. `PoisonMessageError` → reject with `requeue=False`.
5. Other exceptions → inspect `x-delivery-count`; requeue while under `settings.MAX_RETRIES`, else `reject(requeue=False)` to DLQ.
6. Always `handler_sem.release()` in `finally` (line 2356).

On supervisor restart `consume_queue` drains all in-flight tasks before closing its per-queue channel (line 2380-2404).

`_supervised_consume` (line 2202-2260) is a restart-on-crash wrapper with exponential backoff (capped at 30 s) — addresses unhandled aio-pika `ChannelClosed` blowing the whole worker process (line 2202-2220).

`_process_single_backup` (line 2866-3260) is the canonical lifecycle for a single resource — broken into three phases with short-lived sessions so a Power BI / large-mailbox backup doesn't pin a DB connection across minutes of HTTPS work (line 2872-2879):

1. Brief read session: load `Job`, drop CANCELLED jobs (line 2887-2936; cancel cleanup fires a fire-and-forget `cleanup_cancelled_snapshots` task), load `Resource` + `Tenant`, run the RMQ-redelivery intake guard (line 2947-3026 — terminal-snapshot check + fresh-IN_PROGRESS check against `ix_snapshots_job_resource_inprogress` partial unique index), `expunge_all` and release the session.
2. Network work: pick Graph client (`get_graph_client(tenant, handler_key=resource_type)` so each Tier-2 type uses a different round-robin Graph app), `create_snapshot(...)`, tick job to 15 %, emit `BACKUP_STARTED` audit, call the handler from `_HANDLER_TABLE`, tick job to 95 % on return.
3. Finalize (each step a fresh short session): `fail_snapshot` + parent-job rollup on exception (with `INACCESSIBLE` flag for 404/423/locked Graph errors at line 3083-3099); on success, `complete_snapshot`, `_reap_orphan_snapshots_for_job` (resource-scoped), `_finalize_bulk_parent_if_complete` for fan-out parents (line 3216-3236), `update_resource_backup_info`, `BACKUP_COMPLETED` audit. Whenever `snapshot.extra_data["partitioned"]=True`, every finalize step is *skipped* — the partition shards' `_finalize_partitioned_snapshot` (line 10772) is the last-finisher and owns the terminal flip (line 3164-3214).

`_process_mass_backup` (line 3263-3429) is a thin coordinator that, when `BACKUP_FANOUT_ENABLED=true` (default) and `RABBITMQ_ENABLED`, re-publishes N per-resource messages via `_fanout_bulk_to_per_resource` (line 3431) — splits the bulk Job into N children sharing `job_id`, exits the replica quickly. Legacy in-process iterate path (line 3346 onwards) gated by `BACKUP_FANOUT_ENABLED=false` is kept as the rollback escape hatch.

Partition consumers (`_process_*_partition_message`) all follow the same pattern (e.g. line 11201-11469 for OneDrive): atomically claim the `snapshot_partitions` row via `_claim_partition` (line 10618), do the bounded work, mark the row TERMINAL, run `_finalize_partitioned_snapshot` (line 10772) which is the last-finisher that flips the parent snapshot COMPLETED / PARTIAL / FAILED, emits BACKUP_COMPLETED, etc.

### 5. Key features

- **Per-queue prefetch via per-queue channels** (line 2266-2280) — fixes silent prefetch=2 cap from shared-channel.
- **Concurrent handler dispatch** inside one consumer (line 2296-2367) — previously serialized.
- **RMQ redelivery intake guards**: definitive-terminal short-circuit + fresh-IN_PROGRESS dedup (`_process_single_backup` line 2947-3026).
- **CANCELLED job intake guard** (line 2887-2936, 3292-3302) — fires `cleanup_cancelled_snapshots` for blob GC.
- **Idempotent `create_snapshot`** (line 21880-22014) — Postgres advisory xact-lock keyed on `hash((job_id, resource_id))` + partial unique index `ix_snapshots_job_resource_inprogress` to make SELECT+INSERT atomic across replicas.
- **Inline-attachment + chat hosted-content optimisation** (line 78-111) — sub-256 KB binaries land in `extra_data["inline_b64"]` instead of Azure Blob.
- **Per-folder delta token + fingerprint persistence** in dedicated `mail_folder_delta` / `mail_folder_fingerprint` / `sharepoint_drive_delta` tables (line 2459-2670). Replaces JSON-dict-in-extra_data which was unsafe under partition fanout.
- **Reconciliation lease**: `LeaseExtender` (shared.lease) + `HeartbeatThread` (shared.heartbeat) bump `lease_expires_at` on owned rows; `reclaim_for_replica` re-publishes work on startup so a redeploy gap is < 1 s instead of `LEASE_TTL_S` (line 2004-2046, 21962-21982).
- **Partition coordinator + consumer split**: OneDrive / chats / mail / SharePoint / Groups (Teams channels) / Entra directory each get a fanout coordinator that splits work into shards and a partition consumer that drains one shard. Fairness via per-tenant semaphore `_acquire_tenant_slot` (line 2672-2686), capped at `MAX_CONCURRENT_PARTITIONS_PER_TENANT`.
- **Heavy-pool routing**: `BACKUP_WORKER_DEDICATED_ONLY=true` auto-set when this replica's `BACKUP_WORKER_QUEUE` equals `BACKUP_HEAVY_QUEUE` (line 2084-2097) — heavy pool can't steal urgent/high/low away from the light pool; producer-side routing at publish time (`shared.export_routing`) decides workload class.
- **Bulk parent finalization**: `_finalize_bulk_parent_if_complete` (line 22055) — only the last terminal child flips the parent.
- **Anomaly-detector cursor guard**: `_resource_has_incremental_cursor` + `INCREMENTAL_CURSOR_KEYS` (line 1432-1457) — quiet-delta snapshots no longer fire ransomware false positives.
- **Sub-calendar throttle**: `_should_skip_subcalendar` (line 1460-1493) — non-default calendars have no /calendarView/delta, throttled by `SUB_REFRESH_HOURS`.
- **MIME inline-image rescue** for `cid:` references not exposed by Graph's `/messages/{id}/attachments` (line 114-199).
- **Audit** via `AuditLogger` (line 1927-1949) — single HTTP path to `audit-service`; eliminated the dual-write bug that produced duplicate BACKUP / RANSOMWARE_SIGNAL rows.

### 6. Env vars referenced

From `settings`:

`BACKUP_CONCURRENCY`, `WORKLOAD_CONCURRENCY`, `BACKUP_WORKER_QUEUE`, `MAX_RETRIES`, `RABBITMQ_ENABLED`, `MAX_CONCURRENT_ONEDRIVE_BACKUPS_PER_WORKER`, `MAX_CONCURRENT_PARTITIONS_PER_TENANT`, `AUDIT_SERVICE_URL`, `BACKUP_CONTACTS_INCLUDE_DELETED`, `BACKUP_CONTACTS_INCLUDE_RECOVERABLE`, `ONEDRIVE_BACKUP_V2_ENABLED`, `ONEDRIVE_BACKUP_FILE_TIMEOUT_SECONDS`, `ONEDRIVE_BACKUP_FILE_CONCURRENCY`, `ONEDRIVE_PARTITION_ENABLED` / `_MIN_BYTES` / `_MIN_FILES` / `_TARGET_BYTES_PER_SHARD` / `_MAX_SHARDS` / `_STALE_SWEEP_MIN`, `CHATS_PARTITION_ENABLED` / `_MIN_CHATS` / `_TARGET_CHATS_PER_SHARD` / `_MAX_SHARDS`, `MAIL_PARTITION_ENABLED` / `_MIN_FOLDERS` / `_MIN_BYTES` / `_TARGET_BYTES_PER_SHARD` / `_MAX_SHARDS`, `SP_PARTITION_ENABLED` / `_MIN_DRIVES` / `_MIN_BYTES` / `_TARGET_BYTES_PER_SHARD` / `_MAX_SHARDS`, `GROUPS_PARTITION_ENABLED` / `_MIN_CHANNELS` / `_CHANNELS_PER_SHARD` / `_MAX_SHARDS`, `ENTRA_PARTITION_ENABLED` / `_MIN_CATEGORIES` / `_CATEGORIES_PER_SHARD` / `_MAX_SHARDS`, `chat_hosted_content_concurrency`, `chat_hosted_content_max_bytes`, `BATCH_ROW_REDESIGN_ENABLED`.

Raw `os.getenv`:

`BULK_INSERT_CHUNK` (2000), `INLINE_ATTACHMENT_MAX_BYTES` (256 KB), `CHAT_THREAD_DRAIN_FRESHNESS_S` (25200), `WORKER_REGION` (default), `RAILWAY_SERVICE_NAME`, `BACKUP_HEAVY_QUEUE` (backup.heavy), `BACKUP_WORKER_DEDICATED_ONLY`, `BACKUP_URGENT_PREFETCH` (8), `BACKUP_HIGH_PREFETCH` (10), `BACKUP_NORMAL_PREFETCH` (20), `BACKUP_LOW_PREFETCH` (50), `BACKUP_CHATS_PARTITION_PREFETCH` (12), `BACKUP_MAIL_PARTITION_PREFETCH` (4), `BACKUP_SP_PARTITION_PREFETCH` (2), `BACKUP_GROUPS_PARTITION_PREFETCH` (4), `BACKUP_ENTRA_PARTITION_PREFETCH` (4), `ONEDRIVE_RETRY_QUEUE_ENABLED` (true), `BACKUP_FANOUT_ENABLED` (true), `BACKUP_FANOUT_PUBLISH_CHUNK` (200), `BACKUP_GROUP_TIMEOUT_S` (86400), `USER_MAIL_PARALLEL_FOLDERS` (10), `USER_MAIL_TIMEOUT_S` (43200), `USER_MAIL_FULL_RESCAN_DAYS` (3), `USER_MAIL_ATT_CONCURRENCY` (8), `USER_MAIL_UPLOAD_CONCURRENCY` (32), `USER_MAIL_ATT_BATCH` (20), `BLOB_DEDUP_MIN_SIZE_BYTES` (1024), `USER_CHATS_FULL_RESCAN_DAYS` (3), `USER_CHATS_PARALLEL_CHATS` (32), `USER_CHATS_TIMEOUT_S` (43200), `USER_CHATS_APP_SHARDS` (0), `USER_CHATS_ATTACHMENT_CONCURRENCY` (16), `CHAT_DRAIN_RETRIES` (4), `CHAT_HC_MSG_CONCURRENCY` (16), `CHAT_HC_DOWNLOAD_CONCURRENCY` (32), `CHAT_HC_UPLOAD_CONCURRENCY` (32), `CHAT_URL_CACHE_TTL_DAYS` (30), `ONEDRIVE_FLUSH_INTERVAL_S` (30), `LEASE_TTL_S` (60), `AUDIT_EMIT_PARTITION_EVENTS` (false), `SUB_REFRESH_HOURS`.

### 7. External dependencies

- **Microsoft Graph** via `shared.graph_client.GraphClient` (line 1499) + `shared.multi_app_manager.multi_app_manager` (round-robin pool of Graph apps).
- **Power BI / Power Platform** via `shared.power_bi_client.PowerBIClient`, `shared.power_platform_client.PowerPlatformClient`.
- **Azure Blob Storage** via `shared.azure_storage.azure_storage_manager` (multi-shard).
- **Postgres** via `shared.database.async_session_factory` — tables: `Job`, `Resource`, `Tenant`, `Snapshot`, `SnapshotItem`, `SnapshotPartition`, `SlaPolicy`, `mail_folder_delta`, `mail_folder_fingerprint`, `sharepoint_drive_delta`, plus `worker_heartbeats` via `shared.heartbeat`, `batch_pending_users`, `mail_message_bodies`.
- **RabbitMQ** via `shared.message_bus` + `create_onedrive_partition_message`.
- **Audit-service** via HTTP (`{AUDIT_SERVICE_URL}/api/v1/audit/log`) — `AuditLogger` class at line 1927.
- **job-service** via HTTP for tier-2 trigger-bulk fanout chains (in shared modules).
- **Storage router**: `shared.storage.startup.startup_router` / `shutdown_router` (line 22273-22301).
- **Redis** via `shared.graph_rate_limiter.graph_rate_limiter.maybe_init_redis()` (line 22278).
- **shared.lease.LeaseExtender**, **shared.heartbeat.HeartbeatThread**, **shared.reclaim.reclaim_for_replica**.

### 8. Concurrency model

- `self.backup_semaphore = asyncio.Semaphore(8)` — 8 concurrent file streams per worker NIC (line 1970).
- `self.copy_semaphore = asyncio.Semaphore(20)` — Azure Storage account ingress limit (line 1971).
- `self._onedrive_backup_semaphore = asyncio.Semaphore(settings.MAX_CONCURRENT_ONEDRIVE_BACKUPS_PER_WORKER)` — per-worker cap on simultaneous USER_ONEDRIVE jobs (line 1977).
- `self._tenant_backup_semaphores` — lazy per-tenant fairness semaphore, cap `MAX_CONCURRENT_PARTITIONS_PER_TENANT` (line 1984, 2672-2686).
- Per-queue `handler_sem = asyncio.Semaphore(max(1, prefetch_count))` in `consume_queue` (line 2315) — bounds in-flight handlers per queue.
- `_process_mass_backup` legacy path uses `asyncio.Semaphore(settings.WORKLOAD_CONCURRENCY)` per group (line 3356) and `asyncio.Semaphore(settings.BACKUP_CONCURRENCY)` inside `_backup_resource_group` style helpers (line 3742).
- Inner workload semaphores: `USER_MAIL_PARALLEL_FOLDERS` (10), `USER_CHATS_PARALLEL_CHATS` (32), `CHAT_HC_MSG_CONCURRENCY` (16), `CHAT_HC_DOWNLOAD_CONCURRENCY` (32), `CHAT_HC_UPLOAD_CONCURRENCY` (32), `USER_CHATS_ATTACHMENT_CONCURRENCY` (16), `USER_MAIL_ATT_CONCURRENCY` (8), `USER_MAIL_UPLOAD_CONCURRENCY` (32).
- Graph priority ContextVar (`shared.graph_client.graph_priority`) scopes urgent/high/normal/low/partition rate-limit priority across nested handler calls (line 2293-2322).

### 9. Notable algorithms

- **Delta tokens (per-folder)**: `_load_mail_folder_deltas` / `_upsert_mail_folder_delta` (line 2459-2529) and `_load_sharepoint_drive_deltas` / `_upsert_sharepoint_drive_delta` (line 2618-2670). Atomic per-row UPSERT replaces the unsafe whole-mailbox JSON RMW under partition fanout.
- **Fingerprint skip-by-fp** for mail folders: `_load_mail_folder_fingerprints` / `_upsert_mail_folder_fingerprint` (line 2531-2616) with per-folder `baseline_at` (3-day full-rescan window, env `USER_MAIL_FULL_RESCAN_DAYS`).
- **Partitioning**: OneDrive, mail, chats, SharePoint, groups, Entra each compute shards via min-bytes / min-files / target-bytes-per-shard / max-shards (line 9656-10540). Coordinator publishes shard messages and exits; consumer claims a `snapshot_partitions` row (`_claim_partition` line 10618) and runs the appropriate inner loop. Last finisher runs `_finalize_partitioned_snapshot` (line 10772-11200) — single-writer flip of the parent snapshot to COMPLETED / PARTIAL / FAILED with aggregated counts.
- **Dedup**: cross-snapshot via `content_checksum` (SHA-256 on file/attachment bytes) + the `idx_snapshot_items_tenant_checksum` index. BLAKE3 is used only for the integrity hash where there's no cross-release concern (line 47-68). `BLOB_DEDUP_MIN_SIZE_BYTES` (1 KB) gate skips dedup for very small items.
- **Inline-attachment short-circuit** for ≤ 256 KB binaries (`_INLINE_ATTACHMENT_MAX_BYTES`, line 93-111) — avoids 200-500 ms Azure block-list commit per tiny image.
- **Idempotent snapshot creation**: PG xact-scoped advisory lock keyed on `hash((job_id, resource_id))` + partial unique index `ix_snapshots_job_resource_inprogress` (`create_snapshot`, line 21942-22014). Resumes terminal snapshots so late partition shards don't create phantom siblings.
- **RMQ poison-message handling**: missing `jobId` and no recognised `messageType` → `PoisonMessageError` → DLQ without retry (line 213-218, 2803-2814, 2325-2336).
- **Cancellation**: `_is_job_cancelled` + `JobCancelledMidFlight` exception + `_coerce_snapshot_terminal_on_cancel` + `_raise_if_job_cancelled` (lines 1298-1376) form the in-loop cancellation contract; `fail_snapshot` self-marks `extra_data["cancel_phase"]="worker_self_flip"` so the scheduler reaper picks it up (line 22016-22044).
- **Reconciliation lease + heartbeat**: heartbeat row UPSERTed every 10 s, `LeaseExtender` bumps `lease_expires_at` on owned rows (line 2015-2032), `reclaim_for_replica` re-releases work at startup (line 2033-2046).
- **Sweeper / stale-IN_PROGRESS guard**: 25-min freshness check in `_process_single_backup` intake (line 3009-3026) prevents another live worker's in-progress backup from being re-run; older than 25 min → fall through to retry.
- **Anomaly-cursor allowlist** (`INCREMENTAL_CURSOR_KEYS`, line 1432-1444): a 0-item incremental snapshot with any of these cursors set is a quiet delta, NOT a mass-deletion signal.
- **Sub-calendar refresh throttle** via `_should_skip_subcalendar` (line 1460-1493) — non-default calendars (no Graph delta endpoint) refresh at `SUB_REFRESH_HOURS`.
- **MIME inline-image fallback**: `_parse_mime_inline_parts` + `_extract_cid_refs_from_body` (line 114-199) walk the RFC822 tree to recover `cid:` images Graph doesn't expose via `/messages/{id}/attachments`.
- **Bulk fanout chunking**: `BACKUP_FANOUT_PUBLISH_CHUNK` (200) controls per-resource message publish batches (`_fanout_bulk_to_per_resource`, line 3431-3692).

---

## restore-worker

### 1. Purpose

`workers/restore-worker/main.py:1-7` — "Restore Worker - Processes restore jobs from RabbitMQ queues. Handles different restore types: In-place restore (restore to original location), Cross-user restore (restore to different user/resource), Export (download as PST, ZIP, etc.)".

The file is the `RestoreWorker` class (line 507) plus a battery of per-target-type restore helpers (`_restore_email_to_mailbox`, `_restore_file_to_onedrive`, `_restore_file_to_sharepoint`, `_restore_event_to_calendar`, `_restore_contact_to_mailbox`, `_restore_file_version`, `_restore_entra_*`, `_restore_power_*`, `_restore_onenote_items`, `_restore_planner_items`, `_restore_todo_items`, `_restore_user_*`) and AFI-style event transformation helpers (line 168-327). `EXPORT_PST` uses a streaming fetch path (`stream_snapshot_items_by_group`, line 980) so multi-GB mailbox exports run with bounded memory.

### 2. Queues consumed

`start()` at line 556-586:

| Queue | Prefetch |
| --- | --- |
| `restore.urgent` | 10 |
| `<settings.RESTORE_WORKER_QUEUE>` (default `restore.normal`) | 30 |
| `restore.low` | 50 |

`restore.urgent` deliveries get URGENT (=2) Graph priority via `priority_for_queue(queue_name)` scoped per-message through `graph_priority(...)` ContextVar (line 600-617) — every Graph call inside the restore jumps the per-app token bucket ahead of concurrent backup traffic.

### 3. Message types handled

`process_restore_message` (line 623-780) reads `message["restoreType"]` (default `IN_PLACE`) and dispatches via the local handler table (line 724-733):

| `restoreType` | Handler |
| --- | --- |
| `IN_PLACE` | `restore_in_place` (line 1139) |
| `CROSS_USER` | `restore_cross_user` (line 1499) |
| `CROSS_RESOURCE` | `restore_cross_resource` (line 1697) |
| `EXPORT_PST` | `export_as_pst` (line 1747) — streaming fetch |
| `EXPORT_ZIP` | `export_as_zip` (line 2156) |
| `DOWNLOAD` | `export_download` (line 2853) |
| anything else | falls through to `export_download` |

Workload-filter (line 705-718): when `spec.workloads` is present (RestoreModal checkboxes — `Mail`, `OneDrive`, `Contacts`, `Calendar`, `Chats`) the items are filtered to the union of `WORKLOAD_ITEM_TYPES` (line 513-519) before dispatch.

### 4. Processing flow

`consume_queue` (line 588-621) opens the queue via `message_bus.channel.get_queue` (no per-queue channel; restore worker shares the publishing channel) and uses `queue.iterator()` + `async with message.process()` so every delivery is auto-acked on successful return or auto-nacked on exception.

`process_restore_message` (line 623-780):

1. Acquire `self.semaphore` (30 in-flight cap, line 525) and open a DB session.
2. **CANCELLED-at-intake guard** (line 635-652) — `cancel_job` only flips DB state, RMQ message persists; without this `update_job_status(RUNNING)` would reverse the cancel.
3. Flip `Job.status=RUNNING`, `progress_pct=5`, `commit immediately` — releases the row lock so long-running async progress-update tasks can write without waiting on the outer session's lock (line 653-669).
4. Emit `RESTORE_RUNNING` audit (line 670-672).
5. **PST path uses streaming**: `count_snapshot_items` only (no materialisation); `EXPORT_PST` handler receives `items_to_restore=[]` and pulls via `stream_snapshot_items_by_group`. All other handlers receive a materialised `List[SnapshotItem]` from `fetch_snapshot_items` with workload filtering applied (line 674-721).
6. Invoke handler.
7. Terminal status derivation (line 738-760): for export types (`EXPORT_ZIP` / `EXPORT_PST` / `DOWNLOAD`), `exported=0` → `JobStatus.FAILED` (so UI hides Download); otherwise `COMPLETED`. Non-export types map to the existing rule.
8. `update_job_status` + commit + audit (`RESTORE_COMPLETED` / `RESTORE_FAILED`).
9. On exception: rollback, `handle_restore_failure` (increments `attempts`, flips to `RETRYING` until `max_attempts`, then `FAILED`, line 4498-4514), emit `RESTORE_FAILED` audit, re-raise (line 770-780). `message.process()`'s default behaviour on re-raise is nack with requeue, governed by RMQ delivery counts.

### 5. Key features

- **Sibling-snapshot union with newest-wins** (`fetch_snapshot_items` line 782-901 and `count_snapshot_items` line 903-978): for delta-based M365 backups, restoring just one INCREMENTAL snapshot would leave the target missing every item that was captured earlier. The code unions every sibling snapshot of the same resource with `created_at <= picked.created_at`, then `DISTINCT ON (external_id)` newest-wins. Applies uniformly to snapshot-only, folder-filtered and item-id-filtered exports.
- **Calendar series-master expansion** (`stream_snapshot_items_by_group` line 1031-1087): when the UI selects a single recurring-occurrence id, the seriesMaster row is auto-pulled in so the PST writer (which expects masters with recurrence rules) actually emits the export.
- **AFI-style event transform** for calendar restore (`_afi_transform_event_for_restore`, line 182-273; `_EVENT_STRIP_FIELDS` set at line 168-179): Microsoft Graph forces the target mailbox user to be the organizer of any event created in their own calendar. Worker strips `organizer` / `isOrganizer` / `responseStatus` and moves attendees + organizer into a provenance banner in the body so no invitation storm fires and a 403 ErrorAccessDenied is avoided.
- **PST streaming export** via `stream_snapshot_items_by_group` (line 980-1135) — bounded memory regardless of mailbox size via keyset pagination on `(external_id, snapshot_id)` and a fresh DB session per batch.
- **Per-resource MailRestoreEngine** route (line 1257-1290) for `MAILBOX` / `SHARED_MAILBOX` / `ROOM_MAILBOX` / `USER_MAIL` resource types, gated by `MAIL_RESTORE_V2_ENABLED`. OVERWRITE vs SEPARATE conflict mode derived from either `spec.conflictMode=="OVERWRITE"` or `spec.overwrite=true`.
- **ContactRestoreEngine** route (line 1292-1340) gated by `CONTACT_RESTORE_ENGINE_ENABLED`; AGoogle-Graph-$batch-backed pipeline that handles the `:contacts` suffix Tier-2 USER_CONTACTS rows.
- **`_mail_graph_user_id` / `_contact_graph_user_id` / `_calendar_graph_user_id`** (line 68-134) strip the `:mail`, `:contacts`, `:calendar` suffixes that Tier-2 rows append to `external_id` so Graph URLs don't return 404.
- **Cross-user / cross-resource restore** paths (line 1499-1745) — same handler-routing logic but to a different target resource.
- **Power BI / Power Apps / Power Automate / Power DLP** restore handlers (line 3740-4027).
- **OneNote / Planner / TODO** restore handlers (line 4028-4368).
- **Entra restore v2** route (line 1389) gated by `ENTRA_RESTORE_V2_ENABLED`.
- **AzureBlobStorage init via connection string** at startup (line 536-544).
- **Reclaim of orphan exports**: the worker doesn't reclaim, but it survives transport blips via the supervised consume + `aio_pika` robust connection.

### 6. Env vars referenced

From `settings`: `CONTACT_RESTORE_GLOBAL_POOL`, `CONTACT_RESTORE_PER_USER`, `CONTACT_RESTORE_MAX_RETRIES`, `CONTACT_RESTORE_ENGINE_ENABLED`, `MAIL_RESTORE_V2_ENABLED`, `ONEDRIVE_RESTORE_ENGINE_ENABLED`, `ENTRA_RESTORE_V2_ENABLED`, `ENTRA_EXPORT_V2_ENABLED`, `AZURE_STORAGE_ACCOUNT_NAME`, `AZURE_STORAGE_ACCOUNT_KEY`, `MAX_CONCURRENT_EXPORTS_PER_WORKER`, `RESTORE_WORKER_QUEUE`, `AUDIT_SERVICE_URL`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`, `EFFECTIVE_POWER_BI_TENANT_ID`.

From `mail_export_settings`: `EXPORT_MAIL_V2_ENABLED`, `EXPORT_ONEDRIVE_V2_ENABLED`, `EXPORT_PARALLELISM`, `EXPORT_MBOX_SPLIT_BYTES`, `EXPORT_BLOCK_SIZE_BYTES`, `EXPORT_FETCH_BATCH_SIZE`, `EXPORT_FOLDER_QUEUE_MAXSIZE`, `EXPORT_MBOX_INLINE_LIMIT_BYTES`, `EXPORT_ONEDRIVE_MISSING_POLICY`, `EXPORT_ONEDRIVE_MAX_FILE_BYTES`, `EXPORT_ONEDRIVE_PATH_MAX_LEN`, `EXPORT_ONEDRIVE_SANITIZE_CHARS`.

### 7. External dependencies

- **Microsoft Graph** via `shared.graph_client.GraphClient` + `shared.multi_app_manager`.
- **Power BI / Power Platform** via `shared.power_bi_client.PowerBIClient` + `shared.power_platform_client.PowerPlatformClient`.
- **Azure Blob Storage** via direct `azure.storage.blob.BlobServiceClient` (legacy DOWNLOAD path) and `shared.azure_storage.azure_storage_manager` (modern multi-shard).
- **Postgres** via `shared.database.async_session_factory` — tables: `Resource`, `Tenant`, `Job`, `Snapshot`, `SnapshotItem`.
- **RabbitMQ** via `shared.message_bus.message_bus`.
- **audit-service** via HTTP `{AUDIT_SERVICE_URL}/api/v1/audit/log` (`log_audit_event`, line 4516-4542).
- **MailRestoreEngine** (`mail_restore.py`), **EntraRestoreEngine** (`entra_restore.py`), **ContactRestoreEngine** (`contact_restore.py`).
- **PST writers** (`pst_writers/`), **mail_export.py**, **file_export.py**, **entra_export.py**, **pst_export.py**.

### 8. Concurrency model

- `self.semaphore = asyncio.Semaphore(30)` — max 30 concurrent restores per process (line 525).
- `self._export_semaphore = asyncio.Semaphore(settings.MAX_CONCURRENT_EXPORTS_PER_WORKER)` — caps simultaneous export jobs (line 529).
- Module-level `_CONTACT_GLOBAL_SEM` (lazy, size `CONTACT_RESTORE_GLOBAL_POOL`) and per-user `_CONTACT_PER_USER_SEMS` (size `CONTACT_RESTORE_PER_USER`) — bound Graph pressure across in-flight contact restores (line 47-65).
- `graph_priority` ContextVar to bias the per-app token bucket per queue.

### 9. Notable algorithms

- **Sibling-snapshot union + DISTINCT ON newest-wins** — see #5 above.
- **Calendar series-master expansion** — see #5 above.
- **AFI event-restore transform** — see #5 above.
- **PST streaming fetch with keyset pagination** — bounded-memory exports (line 980-1135).
- **Per-message graph-priority scope** — restore.urgent → URGENT priority on the Graph token bucket via ContextVar (line 601-617).
- **Retry/DLQ on `attempts >= max_attempts`** in `handle_restore_failure` (line 4498-4514).
- **Cancellation at intake**: `CANCELLED` jobs are dropped before `update_job_status` to prevent the worker accidentally reversing the user's cancel (line 635-652).
- **Terminal-status derivation by exported_count**: export types with `exported_count==0` are flipped to `FAILED` rather than `COMPLETED` so the UI hides the broken Download button (line 738-760).
- **Robust loop handler**: `install_robust_loop_handler` at startup demotes aio-pika's "Future exception was never retrieved" / ECONNRESET noise (line 4564-4574).

---

## discovery-worker

### 1. Purpose

`workers/discovery-worker/main.py:1-6` — "Discovery Worker - Consumes discovery.m365 queue and runs periodic discovery. Two modes: 1. Queue-driven (primary mode for onboarding); 2. Periodic (24-hour fallback)."

Drives M365 resource discovery via `shared.graph_client.GraphClient.discover_all()` (full scope) or via scoped methods listed in `DISCOVERY_SCOPE_DEFINITIONS` (line 99-147). Azure discovery uses `azure_discovery.discover_azure_tenant`. Tier-2 per-user content discovery is a separate consumer that re-fans-out into the backup pipeline.

### 2. Queues consumed

Started in `main()` at line 1426-1466:

| Queue | Prefetch | Purpose |
| --- | --- | --- |
| `discovery.m365` | (RMQ default) | Primary M365 onboarding discovery (`consume_discovery_queue`, line 964) |
| `discovery.azure` | (RMQ default) | Azure subscription discovery (`consume_azure_discovery_queue`, line 1134) |
| `discovery.tier2` | (RMQ default) | Per-user Tier-2 content discovery + optional backup fanout (`_consume_tier2_discovery`, line 1188) |

All three consumers acquire the queue priority via `priority_for_queue("discovery.m365")` (HIGH) and hold it across the call with `graph_priority(queue_priority)` (line 988-1003, 1160-1170, 1231-1305). Tier-2 reuses the M365 priority deliberately (line 1232-1235).

A `periodic_discovery()` task (line 1453-1457) sleeps 24 h then calls `run_all_discoveries()` (line 1400-1423) as a fallback for re-discovery.

### 3. Message types handled

- **`discovery.m365`** (line 964-1024): body `{tenantId, jobId, discoveryScope}`. `discoveryScope` is an optional list of scope names from `DISCOVERY_SCOPE_DEFINITIONS` (`users`, `groups`, `mailboxes`, `sharepoint`, `teams`, `planner`, `todo`, `power_platform`, `conditional_access`, `bitlocker`) — empty/missing scope means FULL discovery. Aliases: `shared_mailboxes` → `mailboxes` (line 149-151).
- **`discovery.azure`** (line 1134-1185): body `{tenantId, jobId}`. Runs `discover_azure_tenant` against `discover_azure_resources` from `azure_discovery.py`.
- **`discovery.tier2`** (line 1188-1397): body `{tenantId, userResourceIds|userResourceId, source, thenBackup, fullBackup, batchId}`. `source` is one of `SLA_ASSIGNED|BULK_TRIGGER|SCHEDULER_BACKSTOP`. Builds a single `GraphClient` per tenant, calls `shared.tier2_discovery.ensure_tier2_children(...)` per user. Tracks `per_user_outcome` (`BACKUP_ENQUEUED|NO_CONTENT|DISCOVERY_FAILED`) and flips `batch_pending_users.state` from `WAITING_DISCOVERY` to the terminal outcome — race-commute with the watchdog sweeper via `WHERE state='WAITING_DISCOVERY'`. When `thenBackup=true`, POSTs `{resourceIds, fullBackup, priority=1, tier2:true, batchId}` to `{JOB_SERVICE_URL}/api/v1/backups/trigger-bulk`.

Retries (all consumers, line 1011-1024, 1174-1185, 1386-1397): inspect `x-retry-count`; `>=5` → DLQ (`reject(requeue=False)`); otherwise `nack(requeue=True)`.

### 4. Processing flow

For each discovery message:

1. `discover_tenant(tenant_id, discovery_scope)` (line 819-946):
   - Open session, load Tenant, save `previous_status`, decrypt client secret (`decrypt_tenant_secret`, line 329; falls back to env `MICROSOFT_CLIENT_SECRET`), read Power BI refresh token via `PowerBIClient.get_refresh_token_from_tenant(tenant)`.
   - Create a `DiscoveryRun` row with `status='RUNNING'`, flip `Tenant.status=DISCOVERING`, commit.
   - Emit `DISCOVERY_STARTED` audit.
   - Build `GraphClient`. Call `_discover_resources_for_scope` (line 769-816) which either runs `graph.discover_all()` (full) or fans out to scoped methods in parallel via `asyncio.gather` with `_safe_discover` wrappers that catch exceptions per-scope.
   - Prepare staging rows via `_prepare_staging_rows` (line 377-422) — builds `resource_hash` SHA-256 over `{type, external_id, display_name, email, metadata, status}` (line 365-374). Skips unknown types and rows without `external_id`.
   - Open a new session, acquire a Postgres `pg_advisory_xact_lock` keyed on `_tenant_lock_id(tenant_id)` (line 350-352) — serialises per-tenant discovery commits.
   - `_persist_discovery_rows` (line 568-643): chunked INSERTs into `resource_discovery_staging` via `STAGE_INSERT_STMT` (line 171-203); then `MERGE_UPDATED_COUNT_STMT` (line 213-253) and `MERGE_INSERTED_COUNT_STMT` (line 255-302) MERGE into `resources` (preserves ACTIVE, ARCHIVED, SUSPENDED, PENDING_DELETION statuses via `RESOURCE_STATUS_EXPR`); `STALE_MARK_COUNT_STMT` (line 304-326) flips orphaned rows to `INACCESSIBLE`; `DELETE FROM resource_discovery_staging WHERE run_id=...`; runs `_apply_auto_protect_groups` (line 646-766) — auto-protect via resource-group matching.
   - Flip `DiscoveryRun.status=COMPLETED`, write counts (`fetched_count`, `staged_count`, `inserted_count`, `updated_count`, `unchanged_count`, `stale_marked_count`, `finished_at`), set `Tenant.status=ACTIVE`, `last_discovery_at=now`.
   - Emit `DISCOVERY_RUN` audit with `outcome=SUCCESS` and the counts.
2. On exception: `_mark_discovery_failed` (line 547-565) sets `DiscoveryRun.status=FAILED`, restores `Tenant.status=previous_status`, emits `DISCOVERY_RUN` audit `outcome=FAILURE`.
3. ACK after successful DB commit (line 1006).

Azure path mirrors M365 (line 1027-1131) but uses `_prepare_azure_staging_rows` (line 433-544) and dedupes by `(external_id, type)` via `_dedupe_resources` (line 338-347).

Auto-protect (`_apply_auto_protect_groups`, line 646-766) — evaluated after MERGE so newly-inserted rows exist. Eligible when `ResourceGroup.auto_protect_new=True` OR when an attached `SlaPolicy.auto_apply_to_matching=True`. Streams resources without `sla_policy_id` in 1000-row chunks, finds the highest-priority (lowest number, line 686-687) matching group, assigns its first policy. Bulk UPDATE flushes when any policy bucket fills.

### 5. Key features

- **Scope-based discovery** (`DISCOVERY_SCOPE_DEFINITIONS`, line 99-147) with explicit `method_kwargs` controls — Tier-1 mailbox discovery passes `kinds={"SHARED_MAILBOX", "ROOM_MAILBOX"}` so user MAILBOX rows stay Tier-2 only.
- **Power BI delegated auth** with persisted refresh-token rotation via `PowerBIClient.persist_refresh_token` (line 895-900).
- **Per-tenant Postgres advisory xact-lock** to serialise concurrent discovery commits (line 350-352, 886-888).
- **Three-statement MERGE** with status-preserving CASE expression so ACTIVE / ARCHIVED / SUSPENDED / PENDING_DELETION are never demoted to DISCOVERED (line 205-211).
- **Stale-mark covers only successful scope types** (`STALE_MARK_COUNT_STMT`, line 304-326) — a scoped run that didn't ask about `PLANNER` won't mark planner rows stale.
- **Auto-protect** with two eligibility routes (group-level `auto_protect_new=True` OR policy-level `auto_apply_to_matching=True`) and streamed assignment (line 646-766).
- **Tier-2 batched fanout** (line 1188-1397) — single `GraphClient` per tenant per batch, `ensure_tier2_children(commit=False)` per user, one transaction for the whole batch, then trigger-bulk forward.
- **Periodic re-discovery** every 24 h as a fallback (line 1453-1457).

### 6. Env vars referenced

From `settings`: `DISCOVERY_PROGRESS_LOG_EVERY`, `DISCOVERY_STAGE_CHUNK_SIZE`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_TENANT_ID`, `AZURE_AD_CLIENT_ID`, `AZURE_AD_TENANT_ID`, `EFFECTIVE_ARM_CLIENT_ID`, `AUDIT_SERVICE_URL`, `JOB_SERVICE_URL`, `DB_USERNAME`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_SCHEMA`, `RABBITMQ_ENABLED`.

### 7. External dependencies

- **Microsoft Graph** via `shared.graph_client.GraphClient`.
- **Power BI** via `shared.power_bi_client.PowerBIClient`.
- **azure_discovery.discover_azure_tenant** (local module).
- **Postgres** via `shared.database.async_session_factory` — tables: `Tenant`, `Resource`, `DiscoveryRun`, `resource_discovery_staging`, `ResourceGroup`, `GroupPolicyAssignment`, `SlaPolicy`, `batch_pending_users`.
- **RabbitMQ** via `shared.message_bus`.
- **audit-service** via HTTP (`_emit_discovery_audit`, line 41-68).
- **job-service** via HTTP `/api/v1/backups/trigger-bulk` (line 1367-1380) for Tier-2 → backup fanout.
- **shared.tier2_discovery.ensure_tier2_children**.
- **shared.security.decrypt_secret**.
- **shared.resource_group_matcher.find_matching_groups**.

### 8. Concurrency model

- Per-scope discovery via `asyncio.gather(*[_safe_discover(scope) ...])` — N parallel Graph scope calls (line 806).
- One `GraphClient` per tenant per Tier-2 batch (avoids re-building MSAL app + token cache per user, line 1273-1288).
- Tier-2 batches use a single DB transaction (`commit` after the user loop, line 1346) — amortises WAL flush.
- Auto-protect streams resources with `yield_per=CHUNK` (1000), flushes per policy bucket when full (line 711-761).
- No process-level semaphore beyond aio-pika's default prefetch — discovery is low-volume by design.

### 9. Notable algorithms

- **Per-tenant advisory xact-lock** with `_tenant_lock_id` (XOR-folded UUID, line 350-352).
- **Deterministic `resource_hash`** (SHA-256 over canonical JSON, line 361-374) — drives the MERGE-update predicate so unchanged rows skip writes (`r.resource_hash IS DISTINCT FROM s.resource_hash`).
- **Status-preserving merge**: `RESOURCE_STATUS_EXPR` keeps user-controlled lifecycle states intact through re-discovery (line 205-211).
- **Stale-mark only for successful scopes**: avoids flapping `INACCESSIBLE` on categories that weren't even scanned (line 304-326).
- **Tier-2 per-user outcome accounting** with `WAITING_DISCOVERY → BACKUP_ENQUEUED|NO_CONTENT|DISCOVERY_FAILED` race-commute against the watchdog sweeper (line 1326-1346).
- **Retry/DLQ**: `x-retry-count>=5` → DLQ via `reject(requeue=False)` (line 1014-1024 etc.).

---

## chat-export-worker

### 1. Purpose

`workers/chat-export-worker/main.py:1-5` — "chat-export-worker entrypoint. Consumes q.export.chat.thread, renders HTML/JSON/PDF, streams ZIP to blob. v1: one job = one ZIP. v2 will add parent/merge consumers alongside."

The worker is a single-consumer pipeline that resolves a chat thread's messages + attachments, normalizes them, packages into a ZIP via `ThreadPackager` with optional HTML/JSON/PDF rendering, streams the ZIP to Azure Blob (`exports` container, key `{job_id}/export.zip`), and writes a download URL through api-gateway's `/api/v1/jobs/export/{job_id}/download` endpoint so the bytes never leave internal storage publicly.

### 2. Queues consumed

`main()` at line 73-130:

| Queue | Prefetch | Notes |
| --- | --- | --- |
| `q.export.chat.thread` (primary) | 1 (`channel.set_qos(prefetch_count=1)`, line 92) | Consumed by `consume_thread` (line 124-128). DLQ via `dlq.export.chat.thread` declared at line 98-109. |
| `q.export.chat.parent` | (declared, not consumed in v1) | Future v2 parent consumer (line 110-111). |
| `q.export.chat.merge` | (declared, not consumed in v1) | Future v2 merge consumer (line 112-113). |

Exchange is the project-wide `tm.exchange` (DIRECT, durable). The DLQ binding is `{queue}.x-dead-letter-routing-key = "dlq.export.chat.thread"`.

Also starts:
- aiohttp `/health` + `/ready` on port 8081 (line 60-70).
- Prometheus exporter on port 9102 (line 79).
- Signal handlers (SIGTERM, SIGINT) flip a `stop` event so the consumer exits cleanly between deliveries (line 116-128).

### 3. Message types handled

Single envelope shape on `q.export.chat.thread` (`consume_thread`, `workers/chat-export-worker/consumers/thread.py:95-141`):

```
{
  "jobId": "<uuid>",
}
```

Job row is the source of truth. The discriminator is `Job.type == JobType.EXPORT` AND `Job.spec["kind"] == "chat_export_thread"` (cf. `_reclaim_orphan_jobs`, `main.py:33-57`). `Job.spec` carries `{resourceId, snapshotIds, threadPath, itemIds, exportFormat, userEmail}`.

### 4. Processing flow

`consume_thread` (`thread.py:95-141`):

1. `message.process(requeue=False)` — message is acked on context exit, dropped to DLQ on exception (no requeue cycles).
2. Load Job; if `Job.status == CANCELLING` flip to `CANCELLED` and publish a `cancelled` SSE event (line 102-107).
3. `progress.publish` `{stage: "resolving", percent: 5}` (line 100).
4. `scope.resolve(...)` (`scope.py`) — resolves messages, attachment map, hosted-contents map, layout (`single_thread` or `per_message`), and thread path. Raises `ValueError` on a bad scope → `Job.status=FAILED` with `{"error": {"code": <err>}}` and `error` SSE event.
5. The remaining pipeline is wrapped in a try/except so an unhandled exception flips `Job.status=FAILED` with `{"error": {"code": "pipeline_error", "message": str(exc)}}` plus an `error` SSE event (line 132-140) — without this the row would sit `RUNNING` forever even though aio-pika acked the message.

`_run_pipeline` (`thread.py:143-303`):

6. `progress.publish` `{stage: "rendering", percent: 20, messagesTotal: ...}`.
7. Inline-image `src` rewriter — computes per-attachment local paths whose shape MUST match what `ThreadPackager` writes; mismatched sanitisation would produce broken `<img>` links (line 154-182). `tsafe = _safe_name(thread_name)` matches the packager's sanitiser.
8. `normalize_messages(...)` (`render.normalizer`) — maps Graph payloads + hosted-content references to the renderer shape.
9. Cancellation check before write (line 203-206) — flip to `CANCELLED` if `Job.status == CANCELLING`.
10. `tempfile.mkstemp` allocates a spillover ZIP file in `/tmp`; `ThreadPackager.write(...)` streams entries into the ZIP. Attachments resolved via `BlobAttachmentSource.open(blob_path)` which uses Azure SDK `download_blob_stream` for ~4 MiB chunks → bounded RAM (line 33-80).
11. `progress.publish` `{stage: "uploading", percent: 85}`.
12. Cancellation check again (line 228-231).
13. Upload via `upload_blob_with_retry_from_file(container="exports", blob_path=f"{job_id}/export.zip", tmp_path, shard, max_retries=3)`.
14. `os.unlink(tmp_path)` in `finally` (line 243-248).
15. Build api-gateway download URL `{API_GATEWAY_PUBLIC_URL}/api/v1/jobs/export/{job_id}/download` (line 270-283) — explicitly avoids presigned URLs because SeaweedFS isn't directly reachable from end-user browsers and a presigned URL would leak customer chat history.
16. `Job.status=COMPLETED`, `result={export_zip_blob_path, blob_path, container, signed_url, total_msgs, total_bytes, sha256}`, publish `complete` SSE event with `{url, sizeBytes, sha256}`.

`_reclaim_orphan_jobs` at startup (`main.py:22-57`) — there is exactly one chat-export-worker per deployment, so any `RUNNING/PENDING/QUEUED` Job with `spec.kind == "chat_export_thread"` is from a crashed prior run and gets flipped to `FAILED` with `result={"error": {"code": "worker_restart"}}` so the UI sees a terminal state.

### 5. Key features

- **True streaming attachments**: `BlobAttachmentSource.open` yields ~4 MiB chunks from `download_blob_stream`, holds peak RAM at one chunk + ZIP compression buffer instead of the entire blob (line 33-80).
- **Spillover ZIP to disk** (`tempfile.mkstemp`) — even a 100k-message export stays bounded.
- **Inline-image src rewriter** with layout-aware paths matching `ThreadPackager._add` exactly (line 154-182) — broken `<img>` links in exported HTML are prevented by sanitising `thread_name` identically on both sides.
- **CANCELLING-aware**: resolved at job load (line 104-107) AND re-checked before pkg write + before upload (line 203-231).
- **Pipeline error catch-all** wraps normalize→render→package→upload→sign (line 132-140) so an unexpected exception flips the Job to FAILED instead of leaving it `RUNNING`.
- **Startup orphan reclaim** flips zombie chat-export jobs to FAILED on every cold start.
- **Single-consumer DLQ** for poison messages (`message.process(requeue=False)`).
- **api-gateway download URL** instead of presigned URLs — preserves auth, tenant scoping, audit logging.

### 6. Env vars referenced

From `settings`: `RABBITMQ_URL`, `RABBITMQ_CONSUMER_HEARTBEAT_SECONDS`, `AZURE_STORAGE_ACCOUNT_NAME`, `API_GATEWAY_PUBLIC_URL`.

From `os.environ`: `API_GATEWAY_PUBLIC_URL`, `SERVICE_API_GATEWAY_URL` (orchestrator service-discovery fallback).

### 7. External dependencies

- **RabbitMQ** via `aio_pika.connect_robust` (direct connection — does NOT use `message_bus`).
- **Azure Blob Storage** via `shared.azure_storage.azure_storage_manager.get_default_shard()` for both downloads (`download_blob_stream`) and uploads (`upload_blob_with_retry_from_file`). Default container for chat attachments is `tenant-data`; alt prefixes `exports` / `chat-blobs` accepted (line 56-65).
- **Postgres** via `shared.database.async_session_factory` — tables: `Job`, `Resource`.
- **shared.storage.startup.startup_router** (line 81).
- **api-gateway** for the download URL — `services/job-service/main.py:2039` is the endpoint that serves the ZIP.
- Local modules: `workers/chat-export-worker/scope.py` (scope resolver), `render/normalizer.py`, `packager/thread_packager.py` (`ThreadPackager`, `_safe_name`, `AttachmentSource`), `blob_shard.py` (`sign_download_url`), `progress.py` (`publish` for SSE).

### 8. Concurrency model

- `prefetch_count=1` (line 92) — strictly one in-flight export per worker.
- No internal semaphores — each export is sequential by design (one Job = one ZIP).
- ZIP write + blob upload + Graph attachment streams all run on the same task.

### 9. Notable algorithms

- **Streaming attachment download** with size probe (`get_blob_properties` → `size`) followed by chunked async generator (line 67-80).
- **Layout-aware inline-image path computation** (line 166-182) — `single_thread` writes `./{tsafe}-attachments/inline/{hc_id}{ext}`; `per_message` writes `./attachments/inline/{hc_id}{ext}` (HTML lives one directory deeper).
- **Three cancellation gates** — before-resolve, after-render-before-package, before-upload (line 102-107, 203-206, 228-231).
- **Try/except pipeline guard** + `process(requeue=False)` DLQ contract — combined to give exactly-once terminal-row semantics even on aio-pika acks that succeeded before the row was flipped.
- **Orphan reclaim on startup** (`_reclaim_orphan_jobs`, line 22-57) — single-worker-per-deployment invariant lets it unconditionally flip every non-terminal chat-export job to FAILED.

---

## azure-workload-worker

### 1. Purpose

`workers/azure-workload-worker/main.py:1-13` — "Azure Workload Backup Worker — handles Azure VM, SQL, and PostgreSQL backups. This worker is SEPARATE from the M365 backup-worker because M365 backups operate at millisecond scale with thousands of concurrent Graph API calls, while Azure LROs (Long-Running Operations) are minute-to-hour scale. Combining them would cause M365 throttle starvation when an Azure BACPAC export holds a slot for 2 hours."

Routes per `resource.type`:

- `AZURE_VM` → `VmBackupHandler.backup` (Restore Points).
- `AZURE_SQL_DB` / `AZURE_SQL` → `SqlBackupHandler.backup` (PITR / BACPAC).
- `AZURE_POSTGRESQL` / `AZURE_POSTGRESQL_SINGLE` / `AZURE_PG` → `PostgresBackupHandler.backup` (native API / pg_dump).

### 2. Queues consumed

Defined at line 46-56:

| Queue | Prefetch | Purpose |
| --- | --- | --- |
| `azure.vm` | 5 | VM backup (heavy LRO) |
| `azure.sql` | 3 | SQL DB backup (BACPAC hours) |
| `azure.postgres` | 3 | Postgres backup |
| `azure.restore.vm` | 3 | VM restore |
| `azure.restore.sql` | 2 | SQL DB restore |
| `azure.restore.postgres` | 2 | Postgres restore |

Restore queues are separate (`is_restore_queue = queue_name.startswith("azure.restore.")`, line 116) so a stuck BACPAC import can't stall new VM backups. `consume_queue` is called per queue from `start()` (line 98-106).

### 3. Message types handled

Backup envelope (line 311-462) — required field `jobId`; routes by `resource.type.value`:

| Resource type | Handler |
| --- | --- |
| `AZURE_VM` | `vm_handler.backup` |
| `AZURE_SQL_DB`, `AZURE_SQL` | `sql_handler.backup` |
| `AZURE_POSTGRESQL`, `AZURE_POSTGRESQL_SINGLE`, `AZURE_PG` | `pg_handler.backup` |

Restore envelope (line 140-279) — required: `jobId`, `snapshotIds[]`, `resourceId`, `tenantId`, `resourceType`, `restoreType`, `spec.azureRestoreMode`, `spec.azureRestoreParams`. Dispatched by queue name + `spec.azureRestoreMode`:

| Queue | Mode | Handler call |
| --- | --- | --- |
| `azure.restore.vm` | `DISK` | `vm_restore_handler.restore_disk(tenant, snapshot, disk_name, restore_params)` |
| `azure.restore.vm` | other (full VM) | `vm_restore_handler.restore_vm(tenant, snapshot, restore_params)` |
| `azure.restore.sql` | `PITR` | `sql_restore_handler.restore_pitr(...)` |
| `azure.restore.sql` | `SCHEMA_ONLY` | `sql_restore_handler.restore_schema_only(...)` |
| `azure.restore.sql` | other | `sql_restore_handler.restore_full(...)` |
| `azure.restore.postgres` | any | `pg_restore_handler.restore(...)` |

### 4. Processing flow

`consume_queue` per queue (line 108-138) — `queue.iterator()` + `message.ack()` on success / `nack(requeue=True)` while `x-retry-count<5`, `reject(requeue=False)` to DLQ at `>=5`.

Backup path (`process_backup_message`, line 311-462):

1. Load Job; drop CANCELLED at intake (line 332-336).
2. Load Resource + Tenant; missing → skip.
3. Flip Job to `RUNNING` with `progress_pct=5`; mirror `Resource.last_backup_status="RUNNING"` so the UI's denormalized read agrees.
4. Create a `Snapshot` row — `type=FULL|INCREMENTAL` per `spec.fullBackup`, `status=IN_PROGRESS`, `snapshot_label=spec.note or "azure-workload-backup"`.
5. Call the appropriate handler.
6. Update snapshot — `bytes_added` and `bytes_total` BOTH receive the captured `size_bytes|total_size_bytes` so the Recovery sparkline (`bytes_total`) and per-day delta bars (`bytes_added`) both render (line 411-413). `item_count = disks_copied|tables_exported|1`. `status = COMPLETED` or `FAILED`.
7. Update Job to `COMPLETED`/`FAILED`, `progress_pct=100`, `result=...`.
8. Update Resource: `last_backup_job_id`, `last_backup_at`, `last_backup_status`, recompute `storage_bytes = max(0, current + bytes_added - bytes_removed)` (line 425-437).
9. On exception inspect for 404/423/locked → flip `Resource.status="INACCESSIBLE"` (line 446-457).

Restore path (`process_restore_message`, line 140-279):

1. Load Job; drop CANCELLED.
2. Load Snapshot, Resource, Tenant; missing → flip Job FAILED.
3. Flip Job to `RUNNING`, `progress_pct=5`.
4. Emit `RESTORE_RUNNING` audit (line 211-214).
5. Inject `restore_params["job_id"] = str(job_id)` (line 219) so handlers can emit live progress via `shared._progress.update_job_pct`.
6. Dispatch as per the table above.
7. Flip Job to `COMPLETED`/`FAILED`, write `Job.result`, `progress_pct=100`.
8. Emit `RESTORE_COMPLETED` or `RESTORE_FAILED` audit.

### 5. Key features

- **Separate worker from backup-worker** to keep Azure LROs from starving M365 Graph throttle (line 5-7).
- **Restore queues separated from backup queues** so a stuck BACPAC import doesn't pin VM-backup slots (line 43-55).
- **CANCELLED-at-intake guard** on both backup (line 332-336) and restore (line 168-174) paths.
- **Storage-byte delta accumulation** on `Resource.storage_bytes = max(0, current + bytes_added - bytes_removed)` (line 425-437).
- **INACCESSIBLE auto-flag** on 404/423/locked/AuthorizationFailed errors (line 446-457).
- **Live progress** via `restore_params["job_id"]` so handlers tick `Job.progress_pct` independently.
- **Bestow-effort audit** — never blocks the operation; uses 5-second HTTP timeout (line 281-309).
- **bytes_added + bytes_total both populated** so both Recovery sparkline and per-day delta bars render (line 411-413).
- **Snapshot label fallback** to `"azure-workload-backup"` when `spec.note` missing.

### 6. Env vars referenced

From `settings`: `DB_USERNAME`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `RABBITMQ_ENABLED`, `EFFECTIVE_ARM_CLIENT_ID`, `AZURE_BACKUP_RESOURCE_GROUP`, `AUDIT_SERVICE_URL`.

### 7. External dependencies

- **Azure ARM** via the per-workload handlers (`handlers/vm_handler.py`, `sql_handler.py`, `postgres_handler.py`, `vm_restore_handler.py`, `sql_restore_handler.py`, `postgres_restore_handler.py`) — credentials in `lib/arm_credentials.py`, LRO orchestration in `lib/lro.py`, throughput tuning in `lib/azure_copy.py`, `lib/optimizer.py`, `lib/rate_limiter.py`.
- **Azure Blob Storage** via `shared.azure_storage.azure_storage_manager`.
- **Postgres** via `shared.database.async_session_factory` — tables: `Resource`, `Tenant`, `Job`, `Snapshot`.
- **RabbitMQ** via `shared.message_bus.message_bus`.
- **audit-service** via HTTP `{AUDIT_SERVICE_URL}/api/v1/audit/log` (line 281-309).
- **shared.storage.startup.startup_router**, **shared.core_metrics.init()**, **shared.graph_rate_limiter.graph_rate_limiter.maybe_init_redis()** (line 465-476).

### 8. Concurrency model

- Per-queue `prefetch` (5 / 3 / 3 / 3 / 2 / 2) defined at line 46-55. No in-process semaphore beyond what the broker prefetch + iterator awaits enforce — each handler is awaited before the next message is iterated (no concurrent dispatch like backup-worker).
- Six handler instances are instantiated once per worker (`__init__`, line 62-69): `vm_handler`, `sql_handler`, `pg_handler`, `vm_restore_handler`, `sql_restore_handler`, `pg_restore_handler`.
- LRO concurrency / rate-limiting is delegated to `lib/rate_limiter.py` and `lib/azure_copy.py` (per-handler).

### 9. Notable algorithms

- **Queue-name → backup vs restore split** via prefix check `queue_name.startswith("azure.restore.")` (line 116).
- **Mode-keyed dispatch** for restore (`DISK` / `PITR` / `SCHEMA_ONLY` etc.) without a polymorphic registry — explicit `if/elif` keeps the routing audit-traceable in code.
- **Retry/DLQ via `x-retry-count`** (5 attempts) on every message (line 130-137).
- **bytes_total + bytes_added double-write** so the Recovery dashboard's two read paths agree (line 411-413).
- **storage_bytes delta clamp** at `max(0, current + delta)` prevents drift below zero (line 432-434).
- **Audit emission with 5 s timeout** — non-blocking, swallows transport errors silently (line 281-309).
- **RabbitMQ connect retry loop** with 30 attempts at 5 s each on startup (line 83-96).

