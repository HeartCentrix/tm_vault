# TMvault RabbitMQ Queue Topology

All paths are absolute under `tm_backend/`.
Source-of-truth file: `shared/message_bus.py`.

## Architecture overview

- **Single direct exchange** `tm.exchange` (`aio_pika.ExchangeType.DIRECT`, durable). Every queue binds to it with `routing_key == queue_name`.
- **Single library entry point**: `shared.message_bus.MessageBus.connect()` is the one place that declares queues. Every service / worker imports the module-level singleton `message_bus = MessageBus()` and calls `await message_bus.connect()` at startup. The first caller in a process declares the topology; subsequent imports re-use the same connection and channel.
- **Two declaration pathways** outside `MessageBus`:
  1. `workers/chat-export-worker/main.py` opens its own `aio_pika.connect_robust(...)` connection (re-uses the `tm.exchange` name + DIRECT type) and declares three private queues (`q.export.chat.thread`, `q.export.chat.parent`, `q.export.chat.merge`).
  2. `services/storage_toggle_worker/main.py` and `api-gateway/routes/admin_storage.py` open their own connections and declare a `storage.toggle` queue using the **default exchange** (no `tm.exchange` binding).
- **Every queue declared by `MessageBus._declare_queue()` gets a paired DLQ** (`<queue>.dlq`) auto-declared in the same call and bound with routing key `<routing_key>.dlq`. The main queue is configured with:
  - `x-dead-letter-exchange = "tm.exchange"`
  - `x-dead-letter-routing-key = "<routing_key>.dlq"`
  - `x-consumer-timeout = settings.RABBITMQ_CONSUMER_TIMEOUT_MS` (default 7 days)
- **Channel-level QoS** in `connect()` is `prefetch_count=50`, but every long-running consumer (backup-worker, restore-worker, azure-workload-worker) opens its **own per-queue channel** with its own `set_qos()` so the per-queue prefetch values actually apply (see `consume_queue` in `workers/backup-worker/main.py:2262`).
- **Retry / poison handling**:
  - `MAX_RETRIES` env (`settings.MAX_RETRIES`) gates `x-delivery-count` based requeues in backup-worker.
  - Azure & discovery workers use a custom `x-retry-count` header capped at 5 before rejecting to DLQ.
  - `services/backup-scheduler/main.py:2592` runs a dedicated DLQ-consumer loop on `backup.{urgent,high,normal,low}.dlq` that creates `Alert` rows for stuck poison messages.
  - `shared/routing_fence.py` provides an envelope (`expected_workload` + `route_hops`) so a wrong-queue delivery can be republished to the correct queue (cap 2 hops) or DB-dead-lettered.
  - `shared/reconciler.py` re-publishes orphan partition rows via `republish_partition_messages`.
- **Heavy-pool routing** (decided at publish time, not consumer time):
  - `shared/export_routing.pick_backup_queue` sends `USER_ONEDRIVE / ONEDRIVE / SHAREPOINT_SITE / POWER_BI` to `settings.BACKUP_HEAVY_QUEUE` (default `backup.heavy`).
  - `shared/export_routing.pick_restore_queue` sends >20 GiB restores to `restore.heavy`.
  - `shared/export_routing.pick_export_queue` sends >100 GiB exports to `settings.HEAVY_EXPORT_QUEUE` (default `restore.heavy`).
- **`heartbeat = 7 days`** (`RABBITMQ_CONSUMER_HEARTBEAT_SECONDS`) so hour-long OneDrive backups don't trigger consumer redelivery.

### Worker → queue map (consumer fleet at a glance)

| Worker / service | Queues it listens on |
|---|---|
| `workers/backup-worker` | `backup.urgent`, `backup.high`, `<BACKUP_WORKER_QUEUE>` (`backup.normal` or `backup.heavy`), `backup.low`, plus partition lanes: `backup.onedrive_partition`, `backup.chats_partition`, `backup.mail_partition`, `backup.sharepoint_partition`, `backup.groups_partition`, `backup.entra_partition` |
| `workers/restore-worker` | `restore.urgent`, `<RESTORE_WORKER_QUEUE>` (`restore.normal` or `restore.heavy`), `restore.low` |
| `workers/azure-workload-worker` | `azure.vm`, `azure.sql`, `azure.postgres`, `azure.restore.vm`, `azure.restore.sql`, `azure.restore.postgres` |
| `workers/discovery-worker` | `discovery.m365`, `discovery.azure`, `discovery.tier2` |
| `workers/chat-export-worker` | `q.export.chat.thread` (active); `q.export.chat.parent`, `q.export.chat.merge` declared but no consumer / publisher wired today |
| `services/audit-service` | `audit.events` |
| `services/backup-scheduler` (DLQ alerter) | `backup.urgent.dlq`, `backup.high.dlq`, `backup.normal.dlq`, `backup.low.dlq` |
| `services/storage_toggle_worker` | `storage.toggle` (default exchange) |

### Declared-but-unused queues

These five queues are declared at `MessageBus.connect()` but no publish or consume site exists anywhere in the tree:

- `notification`
- `export.normal`
- `delete.low`
- `sla.monitor`
- `report.normal`

`shared/graph_priority.py` does assign them Graph rate-limit priorities, suggesting they were planned future lanes; the autoscaler config in `services/autoscaler/main.py:93` likewise references stale queue names (`restore.jobs`, `discovery.runs`).

## Connection config

Defined in `tm_backend/shared/message_bus.py`.

### `MessageBus` connection params

| Setting | Value | Source |
|---|---|---|
| Connection function | `aio_pika.connect_robust(...)` | line 46 |
| URL | `settings.RABBITMQ_URL` (derived from `RABBITMQ_URL` / `AMQP_URL` env, else `amqp://<user>:<pwd>@<host>:<port>/`) | `shared/config.py:144,903` |
| Heartbeat | `settings.RABBITMQ_CONSUMER_HEARTBEAT_SECONDS` (default `7 * 24 * 3600` s = 7 days) | `shared/config.py:592` |
| Consumer timeout (queue arg) | `settings.RABBITMQ_CONSUMER_TIMEOUT_MS` (default 7 days in ms) | `shared/config.py:593` |
| Enabled flag | `settings.RABBITMQ_ENABLED` (default false; `connect()` no-ops when off) | `shared/config.py:161` |
| Initial-connect retry | Infinite by default (`max_retries=0` → exponential backoff 5→30 s); bounded mode raises after N attempts | `message_bus.py:20-187` |
| Channel-level prefetch | `prefetch_count=50` (overridden per-consumer where it matters) | `message_bus.py:163` |

### Exchange

| Property | Value |
|---|---|
| Name | `tm.exchange` |
| Type | `aio_pika.ExchangeType.DIRECT` |
| Durable | true |
| Binding model | every queue binds with `routing_key == queue_name`; every DLQ binds with `routing_key == "<queue>.dlq"` |

### `MessageBus` public API

| Member | Signature | Behavior |
|---|---|---|
| `connect(max_retries=0, retry_delay=5)` | async | Opens robust connection, declares one channel, declares `tm.exchange`, declares every queue + DLQ pair via `_declare_queue`, sets channel prefetch=50. |
| `disconnect()` | async | Closes the connection. |
| `_declare_queue(queue_name, routing_key)` | async (private) | Declares `<queue>.dlq` (durable) bound on `<routing_key>.dlq`; declares main queue (durable) with x-dead-letter-exchange / x-dead-letter-routing-key / x-consumer-timeout args; binds main queue on `routing_key`. |
| `publish(routing_key, message, priority=5)` | async | JSON-encodes message, publishes to `self.exchange` as PERSISTENT with header `published_at`. No-op if `RABBITMQ_ENABLED=false` or exchange not bound. |
| `consume(queue_name, callback)` | async | Gets the named queue, iterates with `queue.iterator()` + `message.process()`, calls `await callback(decoded_body)`. Used by `audit-service` only — all production workers roll their own consumer loops for per-queue prefetch + DLQ control. |
| `message_bus` (module-level singleton) | `MessageBus()` instance | Shared across all imports in a process. |

## Queue reference

Queue numbering below follows the order they are declared in `MessageBus.connect()`.

### `backup.urgent`

- **Declared**: `shared/message_bus.py:56`
- **Routing key**: `backup.urgent`
- **DLQ**: `backup.urgent.dlq`
- **Publishers**:
  - `services/backup-scheduler/main.py:2099` — preemptive single-resource backup (priority 1).
  - `services/backup-scheduler/main.py:2171` — preemptive tenant-wide mass backup (priority 1).
  - `services/backup-scheduler/main.py:1654` — `/backups/trigger` urgent path (priority 1).
  - `services/job-service/main.py:1623` — `trigger_backup` for M365 resources after `pick_backup_queue` fall-back (`default_queue=AZURE_WORKLOAD_QUEUES[...] or "backup.urgent"`).
  - `services/job-service/main.py:1754` — `/backups/trigger-user` per-resource publish (priority 1).
- **Consumer(s)**:
  - `workers/backup-worker/main.py:2122-2127` (queues table) + `:2281-2285` ("Listening on …"); per-queue channel; default prefetch=8 (`BACKUP_URGENT_PREFETCH`).
- **Message kinds**: `create_backup_message` (single resource) and `create_mass_backup_message` (bulk) — see Message factories.
- **Prefetch / priority**: prefetch 8 per replica (env `BACKUP_URGENT_PREFETCH`); publish priority 1; graph priority `URGENT`.
- **Purpose**: User-initiated and preemptive backup jobs that should jump in front of scheduled traffic.

### `backup.high`

- **Declared**: `shared/message_bus.py:57`
- **Routing key**: `backup.high`
- **DLQ**: `backup.high.dlq`
- **Publishers**: No direct `publish("backup.high", …)` site; reachable only via dynamic `routing_key` selection. `services/backup-scheduler/dispatch_policy_backups` writes to whichever `group_queue` was picked for the resource type — heavy types land on `backup.heavy`, normal on `backup.normal`. `backup.high` is reserved for "scheduled bulk" traffic and surfaces in tests + DLQ-consumer config.
- **Consumer(s)**: `workers/backup-worker/main.py:2124` — prefetch 10 (env `BACKUP_HIGH_PREFETCH`).
- **Message kinds**: Same as `backup.normal` (`create_mass_backup_message` / `create_backup_message`).
- **Prefetch / priority**: prefetch 10; graph priority `HIGH`.
- **Purpose**: Scheduled bulk triggers — a higher-priority lane than `backup.normal` for SLA-driven runs.

### `backup.normal`

- **Declared**: `shared/message_bus.py:58`
- **Routing key**: `backup.normal`
- **DLQ**: `backup.normal.dlq`
- **Publishers**:
  - `workers/backup-worker/main.py:3604` — bulk fan-out chunked publish (worker sub-tasks).
  - `services/backup-scheduler/main.py:532` — stale-snapshot sweep retry, picks queue via `pick_backup_queue(default_queue="backup.normal")`.
  - `services/backup-scheduler/main.py:1230` — `outbox_reconcile` republish of stuck QUEUED jobs (`queue` resolved per-resource).
  - `services/backup-scheduler/main.py:1906` — `dispatch_policy_backups` mass publish (resolved `group_queue`).
  - `services/backup-scheduler/main.py:2730` — `retry_failed_snapshots` sweep.
  - `services/job-service/main.py:598` — batch backup fan-out (`routing_key` resolved per resource type / size).
- **Consumer(s)**: `workers/backup-worker/main.py:2125` — prefetch 20 (env `BACKUP_NORMAL_PREFETCH`). On the heavy replica fleet, `BACKUP_WORKER_QUEUE=backup.heavy` replaces this entry.
- **Message kinds**: `create_backup_message`, `create_mass_backup_message`, and partition / retry envelopes.
- **Prefetch / priority**: prefetch 20 per replica; publish priority 1-5; graph priority `NORMAL`.
- **Purpose**: Default lane for scheduled / sweep / batch M365 backups.

### `backup.low`

- **Declared**: `shared/message_bus.py:59`
- **Routing key**: `backup.low`
- **DLQ**: `backup.low.dlq`
- **Publishers**: No direct publish site found. Surfaces in DLQ consumer config and as a low-priority lane reserved for retention sweeps.
- **Consumer(s)**: `workers/backup-worker/main.py:2126` — prefetch 50 (env `BACKUP_LOW_PREFETCH`).
- **Message kinds**: Same shape as `backup.normal`.
- **Prefetch / priority**: prefetch 50; graph priority `NORMAL`.
- **Purpose**: Low-priority sweep / retention / housekeeping backup work where latency doesn't matter.

### `backup.heavy` (`settings.BACKUP_HEAVY_QUEUE`)

- **Declared**: `shared/message_bus.py:63-66` (queue name = `settings.BACKUP_HEAVY_QUEUE`, default `backup.heavy`).
- **Routing key**: same as queue name.
- **DLQ**: `backup.heavy.dlq`
- **Publishers**: Indirect — chosen by `shared/export_routing.pick_backup_queue` for resource types `USER_ONEDRIVE`, `ONEDRIVE`, `SHAREPOINT_SITE`, `POWER_BI`. Call sites that route to it: `services/job-service/main.py:1611`, `services/job-service/main.py:1748`, `services/backup-scheduler/main.py:519`, `:2719`. Also exercised by tests at `tests/shared/test_reconciler.py:251`.
- **Consumer(s)**: `workers/backup-worker/main.py` — when `BACKUP_WORKER_QUEUE=backup.heavy`, this replaces the `backup.normal` slot in the consumer table (line 2125). The heavy replica auto-detects (line 2084) and goes into `DEDICATED_ONLY` mode at line 2093, consuming ONLY this queue with prefetch 20.
- **Message kinds**: `create_backup_message`, `create_mass_backup_message` — same envelopes as the light pool.
- **Prefetch / priority**: prefetch 20 dedicated; graph priority `NORMAL`.
- **Purpose**: Dedicated worker pool for I/O-heavy file-content backups so a single 500 GB OneDrive can't starve mailbox / Entra work on the shared lanes.

### `backup.onedrive_partition`

- **Declared**: `shared/message_bus.py:72-75`
- **Routing key**: `backup.onedrive_partition`
- **DLQ**: `backup.onedrive_partition.dlq`
- **Publishers**:
  - `workers/backup-worker/main.py:9789` — OneDrive coordinator fans out N shard messages per partitioned drive (priority 3).
  - `services/backup-scheduler/main.py:913` — partition stale sweep re-publish for `ONEDRIVE_FILES` type.
  - `shared/reconciler.py:498` — `republish_partition_messages` for orphan partitions (queue resolved via `_PARTITION_QUEUE_BY_TYPE`).
- **Consumer(s)**: `workers/backup-worker/main.py:2135` (gated by `settings.ONEDRIVE_PARTITION_ENABLED`) — prefetch 2.
- **Message kinds**: `create_onedrive_partition_message` → `messageType=BACKUP_ONEDRIVE_PARTITION`.
- **Prefetch / priority**: prefetch 2 per replica; publish priority 3.
- **Purpose**: Cross-replica shard of one partitioned OneDrive snapshot — workers atomically claim a `snapshot_partitions` row and drain that shard's `file_ids` slice.

### `backup.chats_partition`

- **Declared**: `shared/message_bus.py:84-87`
- **Routing key**: `backup.chats_partition`
- **DLQ**: `backup.chats_partition.dlq`
- **Publishers**:
  - `workers/backup-worker/main.py:10112` — `USER_CHATS` coordinator fans out per-shard messages (priority 3).
  - `services/backup-scheduler/main.py:928` — partition stale sweep for `CHATS` type.
  - `shared/reconciler.py:498` (via `_PARTITION_QUEUE_BY_TYPE`).
- **Consumer(s)**: `workers/backup-worker/main.py:2149-2151` (gated by `settings.CHATS_PARTITION_ENABLED`) — prefetch 12 (env `BACKUP_CHATS_PARTITION_PREFETCH`).
- **Message kinds**: `create_chats_partition_message` → `messageType=BACKUP_CHATS_PARTITION`.
- **Prefetch / priority**: prefetch 12 per replica; publish priority 3.
- **Purpose**: Per-shard partitioned `USER_CHATS` snapshot — each message carries a `chatIds` allowlist; workers re-enter the `USER_CHATS` coordinator pipeline scoped to those chats.

### `backup.mail_partition`

- **Declared**: `shared/message_bus.py:94-97`
- **Routing key**: `backup.mail_partition`
- **DLQ**: `backup.mail_partition.dlq`
- **Publishers**:
  - `workers/backup-worker/main.py:9983` — mailbox coordinator (all four mailbox types) fans out shard messages.
  - `services/backup-scheduler/main.py:947` — partition stale sweep for `MAIL_FOLDERS`.
  - `shared/reconciler.py:498` via `_PARTITION_QUEUE_BY_TYPE`.
- **Consumer(s)**: `workers/backup-worker/main.py:2156-2158` (gated by `settings.MAIL_PARTITION_ENABLED`) — prefetch 4.
- **Message kinds**: `create_mail_partition_message` → `messageType=BACKUP_MAIL_PARTITION`.
- **Prefetch / priority**: prefetch 4 per replica; publish priority 3.
- **Purpose**: Per-shard partitioned mailbox snapshot (USER_MAIL / MAILBOX / SHARED_MAILBOX / ROOM_MAILBOX) — each message carries a `folderIds` allowlist and `resourceType`.

### `backup.sharepoint_partition`

- **Declared**: `shared/message_bus.py:103-106`
- **Routing key**: `backup.sharepoint_partition`
- **DLQ**: `backup.sharepoint_partition.dlq`
- **Publishers**:
  - `workers/backup-worker/main.py:10314` — SharePoint coordinator fans out one shard per drive bucket.
  - `services/backup-scheduler/main.py:965` — partition stale sweep for `SHAREPOINT_DRIVES`.
  - `shared/reconciler.py:498` via `_PARTITION_QUEUE_BY_TYPE`.
- **Consumer(s)**: `workers/backup-worker/main.py:2163-2165` (gated by `settings.SP_PARTITION_ENABLED`) — prefetch 2.
- **Message kinds**: `create_sharepoint_partition_message` → `messageType=BACKUP_SHAREPOINT_PARTITION`.
- **Prefetch / priority**: prefetch 2 per replica; publish priority 3.
- **Purpose**: Per-shard SharePoint snapshot — each message carries a `driveIds` allowlist for a single `siteId`.

### `backup.groups_partition`

- **Declared**: `shared/message_bus.py:112-115`
- **Routing key**: `backup.groups_partition`
- **DLQ**: `backup.groups_partition.dlq`
- **Publishers**: `workers/backup-worker/main.py:10456` — Groups (Teams channel) coordinator fans out one shard per channel bucket.
- **Consumer(s)**: `workers/backup-worker/main.py:2170-2172` (gated by `settings.GROUPS_PARTITION_ENABLED`) — prefetch 4.
- **Message kinds**: `create_groups_partition_message` → `messageType=BACKUP_GROUPS_PARTITION`.
- **Prefetch / priority**: prefetch 4 per replica; publish priority 3.
- **Purpose**: Per-shard Teams channel snapshot — each message carries a `channelIds` allowlist for one `teamId`. Mailbox / SP sub-backups owned by the coordinator are skipped on consumer entries.

### `backup.entra_partition`

- **Declared**: `shared/message_bus.py:124-127`
- **Routing key**: `backup.entra_partition`
- **DLQ**: `backup.entra_partition.dlq`
- **Publishers**: `workers/backup-worker/main.py:10608` — Entra directory coordinator fans out one shard per directory-category bucket.
- **Consumer(s)**: `workers/backup-worker/main.py:2178-2180` (gated by `settings.ENTRA_PARTITION_ENABLED`) — prefetch 4.
- **Message kinds**: `create_entra_partition_message` → `messageType=BACKUP_ENTRA_PARTITION`.
- **Prefetch / priority**: prefetch 4 per replica; publish priority 3.
- **Purpose**: Per-shard Entra directory snapshot — `categoryIds` allowlist scoping the drain to a subset of the 8 categories (USERS / GROUPS / ROLES / SECURITY / AUDIT / APPLICATIONS / INTUNE / ADMIN_UNITS).

### `restore.urgent`

- **Declared**: `shared/message_bus.py:128`
- **Routing key**: `restore.urgent`
- **DLQ**: `restore.urgent.dlq`
- **Publishers**: Indirect — selected by `shared.message_bus.create_restore_message` `queue_map` when `restoreType=="CROSS_USER"`. Published via the `queue` field returned in the message at `services/job-service/main.py:2091` and `:2236`.
- **Consumer(s)**: `workers/restore-worker/main.py:575` — prefetch 10.
- **Message kinds**: `create_restore_message` output.
- **Prefetch / priority**: prefetch 10; publish priority 3 for `CROSS_USER`; graph priority `URGENT`.
- **Purpose**: Cross-user / urgent restores that should jump the restore queue.

### `restore.normal`

- **Declared**: `shared/message_bus.py:129`
- **Routing key**: `restore.normal`
- **DLQ**: `restore.normal.dlq`
- **Publishers**: Indirect — `create_restore_message` default for `IN_PLACE`, `CROSS_RESOURCE`, `EXPORT_PST`. Heavy override possible via `pick_export_queue` / `pick_restore_queue`. Concrete publish sites: `services/job-service/main.py:2091` (restore), `:2236` (export).
- **Consumer(s)**: `workers/restore-worker/main.py:576` — `_s.RESTORE_WORKER_QUEUE` (default `restore.normal`); prefetch 30.
- **Message kinds**: `create_restore_message` output.
- **Prefetch / priority**: prefetch 30; publish priority 4-6; graph priority `HIGH`.
- **Purpose**: Default restore lane for in-place restores, cross-resource restores, and small PST exports.

### `restore.low`

- **Declared**: `shared/message_bus.py:130`
- **Routing key**: `restore.low`
- **DLQ**: `restore.low.dlq`
- **Publishers**: Indirect — `create_restore_message` default for `EXPORT_ZIP` / `DOWNLOAD` restore types.
- **Consumer(s)**: `workers/restore-worker/main.py:577` — prefetch 50.
- **Message kinds**: `create_restore_message` output.
- **Prefetch / priority**: prefetch 50; publish priority 7-8; graph priority `NORMAL`.
- **Purpose**: Background ZIP exports and bulk file downloads where latency doesn't matter.

### `restore.heavy` (`settings.HEAVY_EXPORT_QUEUE`)

- **Declared**: `shared/message_bus.py:134-137` (queue name = `settings.HEAVY_EXPORT_QUEUE`, default `restore.heavy`).
- **Routing key**: same as queue name.
- **DLQ**: `restore.heavy.dlq`
- **Publishers**: Indirect — selected by `shared.export_routing.pick_export_queue` (>100 GiB exports) and `pick_restore_queue` (>20 GiB restores). Concrete publish sites: `services/job-service/main.py:2091`, `:2236`; `shared/message_bus.py:531-534` (`create_restore_message` whale-traffic override).
- **Consumer(s)**: `workers/restore-worker/main.py:576` — when `RESTORE_WORKER_QUEUE=restore.heavy` it replaces the `restore.normal` slot in the consumer table. Same prefetch=30 lane.
- **Message kinds**: `create_restore_message` output (large export / restore variants).
- **Prefetch / priority**: prefetch 30 dedicated; publish priority 5-7.
- **Purpose**: Dedicated worker pool with larger memory limits for whale exports & restores; keeps the normal restore lane responsive.

### `discovery.m365`

- **Declared**: `shared/message_bus.py:138`
- **Routing key**: `discovery.m365`
- **DLQ**: `discovery.m365.dlq`
- **Publishers**:
  - `services/auth-service/main.py:546` — after M365 admin consent (priority 5).
  - `services/auth-service/main.py:885` — after Power Platform consent (priority 5, `power_platform` scope).
  - `services/backup-scheduler/main.py:2320` — `RECONCILER` re-enqueue for tenants stuck `PENDING_DISCOVERY` >10 min.
- **Consumer(s)**: `workers/discovery-worker/main.py:982-983` (`_consume_m365_discovery`); no explicit prefetch override (uses default 50 channel-level QoS).
- **Message kinds**: M365 discovery envelope `{jobId, tenantId, externalTenantId, discoveryScope, triggeredBy, triggeredAt}`.
- **Prefetch / priority**: channel prefetch 50; publish priority 5; graph priority `HIGH`.
- **Purpose**: Tenant-wide M365 discovery — drives the Tier-1 resource catalogue (users, groups, mailboxes, shared_mailboxes, sharepoint, teams, power_platform).

### `discovery.azure`

- **Declared**: `shared/message_bus.py:139`
- **Routing key**: `discovery.azure`
- **DLQ**: `discovery.azure.dlq`
- **Publishers**:
  - `services/auth-service/main.py:741` — after Azure ARM consent (priority 5).
  - `services/tenant-service/main.py:419` — manual `/discover` API trigger (priority 5).
- **Consumer(s)**: `workers/discovery-worker/main.py:1152,1157` (`discover_azure_tenant` consumer loop).
- **Message kinds**: Azure discovery envelope `{jobId, tenantId, externalTenantId, discoveryScope=[azure_vms, azure_sql, azure_postgresql], triggeredBy, triggeredAt}`.
- **Prefetch / priority**: channel prefetch 50; publish priority 5; graph priority `HIGH`.
- **Purpose**: Tenant-wide Azure resource discovery via Afi-style delegated ARM access.

### `discovery.tier2`

- **Declared**: `shared/message_bus.py:144`
- **Routing key**: `discovery.tier2`
- **DLQ**: `discovery.tier2.dlq`
- **Publishers**:
  - `services/resource-service/main.py:90` — fired on SLA assignment, batches by tenant (priority 5).
  - `services/job-service/main.py:370` — chained from `/backups/trigger-bulk`, sets `thenBackup=true` (priority 5).
  - `services/backup-scheduler/main.py:1283` — scheduler backstop sweep for users missing Tier-2 children (priority 4).
- **Consumer(s)**: `workers/discovery-worker/main.py:1224,1229` (`_consume_tier2_discovery`).
- **Message kinds**: Tier-2 discovery envelope `{tenantId, userResourceIds[] (preferred) | userResourceId, source, thenBackup, fullBackup, batchId}`.
- **Prefetch / priority**: channel prefetch 50; publish priority 4-5; graph priority `HIGH` (reuses `discovery.m365` priority).
- **Purpose**: Per-user Tier-2 content discovery (USER_MAIL / USER_ONEDRIVE / USER_CONTACTS / USER_CALENDAR / USER_CHATS). Kept separate from `discovery.m365` so fan-out can't block tenant rediscovery.

### `notification`

- **Declared**: `shared/message_bus.py:145`
- **Routing key**: `notification`
- **DLQ**: `notification.dlq`
- **Publishers**: None found.
- **Consumer(s)**: None found.
- **Message kinds**: `create_notification_message` shape `{alertId, severity, message, createdAt}` — factory exists, no producer wired.
- **Prefetch / priority**: graph priority `NORMAL` per `shared/graph_priority.py:77`.
- **Purpose**: Planned alert / notification fan-out lane; currently inactive.

### `export.normal`

- **Declared**: `shared/message_bus.py:146`
- **Routing key**: `export.normal`
- **DLQ**: `export.normal.dlq`
- **Publishers**: None found (export workflow now goes through `restore.normal` / `restore.heavy` via `pick_export_queue`).
- **Consumer(s)**: None found.
- **Message kinds**: n/a.
- **Prefetch / priority**: graph priority `HIGH` per `shared/graph_priority.py:62`.
- **Purpose**: Legacy export lane; superseded by `restore.normal` / `restore.heavy`; declaration kept for backward compat.

### `delete.low`

- **Declared**: `shared/message_bus.py:147`
- **Routing key**: `delete.low`
- **DLQ**: `delete.low.dlq`
- **Publishers**: None found.
- **Consumer(s)**: None found.
- **Message kinds**: n/a.
- **Prefetch / priority**: graph priority `NORMAL`.
- **Purpose**: Planned low-priority delete / retention lane; currently inactive (retention work runs directly inside `services/backup-scheduler`).

### `sla.monitor`

- **Declared**: `shared/message_bus.py:148`
- **Routing key**: `sla.monitor`
- **DLQ**: `sla.monitor.dlq`
- **Publishers**: None found.
- **Consumer(s)**: None found.
- **Message kinds**: n/a.
- **Prefetch / priority**: graph priority `HIGH`.
- **Purpose**: Planned SLA-violation monitor lane; currently inactive (`check_sla_violations` in scheduler runs in-process).

### `report.normal`

- **Declared**: `shared/message_bus.py:149`
- **Routing key**: `report.normal`
- **DLQ**: `report.normal.dlq`
- **Publishers**: None found.
- **Consumer(s)**: None found.
- **Message kinds**: n/a.
- **Prefetch / priority**: graph priority `HIGH`.
- **Purpose**: Planned report-generation lane; currently inactive (report-service runs synchronously over HTTP).

### `audit.events`

- **Declared**: `shared/message_bus.py:150`
- **Routing key**: `audit.events`
- **DLQ**: `audit.events.dlq`
- **Publishers**:
  - `services/backup-scheduler/main.py:325` — policy reconcile audit (priority 4).
  - `services/backup-scheduler/main.py:363` — SLA skip audit events (priority 3).
- **Consumer(s)**: `services/audit-service/main.py:2803` (`await message_bus.consume("audit.events", callback)`) — uses the library's `consume()` path, so it runs on the shared channel with prefetch=50.
- **Message kinds**: `create_audit_event_message` output (full audit envelope).
- **Prefetch / priority**: channel prefetch 50; publish priority 3-4; graph priority `HIGH`.
- **Purpose**: Async audit-trail ingestion — the only queue still using the convenience `MessageBus.consume()` helper.

### `azure.vm`

- **Declared**: `shared/message_bus.py:153`
- **Routing key**: `azure.vm`
- **DLQ**: `azure.vm.dlq`
- **Publishers**: Indirect — `services/job-service/main.py:1603` routes resources of type `AZURE_VM` here via `AZURE_WORKLOAD_QUEUES`; also `services/backup-scheduler/main.py:1845`, `:2714`.
- **Consumer(s)**: `workers/azure-workload-worker/main.py:46,113-114` (declared in `BACKUP_QUEUES`) — prefetch 5.
- **Message kinds**: `create_backup_message` / `create_mass_backup_message`.
- **Prefetch / priority**: prefetch 5 (lower — VM backups are heavy LROs).
- **Purpose**: Azure VM backups via Restore Points; isolated from M365 so a 2 h BACPAC can't starve Graph traffic.

### `azure.sql`

- **Declared**: `shared/message_bus.py:154`
- **Routing key**: `azure.sql`
- **DLQ**: `azure.sql.dlq`
- **Publishers**: Indirect via `AZURE_WORKLOAD_QUEUES` (`AZURE_SQL_DB` / `AZURE_SQL`). Same call sites as `azure.vm`.
- **Consumer(s)**: `workers/azure-workload-worker/main.py:48` — prefetch 3.
- **Message kinds**: `create_backup_message` / `create_mass_backup_message`.
- **Prefetch / priority**: prefetch 3 (BACPAC exports can take hours).
- **Purpose**: Azure SQL Database backups via PITR / BACPAC.

### `azure.postgres`

- **Declared**: `shared/message_bus.py:155`
- **Routing key**: `azure.postgres`
- **DLQ**: `azure.postgres.dlq`
- **Publishers**: Indirect via `AZURE_WORKLOAD_QUEUES` (`AZURE_POSTGRESQL` / `AZURE_POSTGRESQL_SINGLE` / `AZURE_PG`).
- **Consumer(s)**: `workers/azure-workload-worker/main.py:49` — prefetch 3.
- **Message kinds**: `create_backup_message` / `create_mass_backup_message`.
- **Prefetch / priority**: prefetch 3.
- **Purpose**: Azure PostgreSQL backups via native API / `pg_dump`.

### `azure.restore.vm`

- **Declared**: `shared/message_bus.py:158`
- **Routing key**: `azure.restore.vm`
- **DLQ**: `azure.restore.vm.dlq`
- **Publishers**: Indirect — `create_restore_message` returns this queue for resource types in `AZURE_RESTORE_QUEUE_BY_TYPE` (`AZURE_VM`). Publish sites: `services/job-service/main.py:2091`.
- **Consumer(s)**: `workers/azure-workload-worker/main.py:52` — prefetch 3; dispatches via `is_restore_queue` branch.
- **Message kinds**: `create_restore_message` output (with `spec.azureRestoreMode` ∈ {FULL_VM, DISK, …} and `spec.azureRestoreParams`).
- **Prefetch / priority**: prefetch 3.
- **Purpose**: Azure VM restores; isolated so a stuck BACPAC import can't stall new VM restores.

### `azure.restore.sql`

- **Declared**: `shared/message_bus.py:159`
- **Routing key**: `azure.restore.sql`
- **DLQ**: `azure.restore.sql.dlq`
- **Publishers**: Indirect via `AZURE_RESTORE_QUEUE_BY_TYPE` for `AZURE_SQL_DB` / `AZURE_SQL`.
- **Consumer(s)**: `workers/azure-workload-worker/main.py:53` — prefetch 2.
- **Message kinds**: `create_restore_message` output.
- **Prefetch / priority**: prefetch 2.
- **Purpose**: Azure SQL restores (PITR / BACPAC import) on the dedicated Azure pool.

### `azure.restore.postgres`

- **Declared**: `shared/message_bus.py:160`
- **Routing key**: `azure.restore.postgres`
- **DLQ**: `azure.restore.postgres.dlq`
- **Publishers**: Indirect via `AZURE_RESTORE_QUEUE_BY_TYPE` for `AZURE_POSTGRESQL` / `AZURE_POSTGRESQL_SINGLE` / `AZURE_PG`.
- **Consumer(s)**: `workers/azure-workload-worker/main.py:54` — prefetch 2.
- **Message kinds**: `create_restore_message` output.
- **Prefetch / priority**: prefetch 2.
- **Purpose**: Azure PostgreSQL restores on the dedicated Azure pool.

### `q.export.chat.thread`

- **Declared**: `workers/chat-export-worker/main.py:99-107` (declares OWN `tm.exchange` direct binding; same exchange the library uses, but the queue is NOT auto-declared by `MessageBus.connect()`).
- **Routing key**: `q.export.chat.thread`
- **DLQ**: `dlq.export.chat.thread` (declared at line 108).
- **Publishers**: `services/job-service/chat_export.py:341` — `POST /api/v1/jobs/chat-export` (priority default 5).
- **Consumer(s)**: `workers/chat-export-worker/main.py:115,124` (`worker started queue=q.export.chat.thread`); channel prefetch=1.
- **Message kinds**: `{jobId, tenantId}` envelope; Job row carries the full `spec` (resourceId, chatId, idempotency_key, layoutMode, estimatedMessages, estimatedBytes…).
- **Prefetch / priority**: channel prefetch=1 (CPU- and memory-heavy ZIP rendering).
- **Purpose**: One Teams chat thread export → renders HTML / JSON / PDF, streams ZIP to blob.

### `q.export.chat.parent`

- **Declared**: `workers/chat-export-worker/main.py:110-111` (durable, bound to `tm.exchange`).
- **Routing key**: `q.export.chat.parent`
- **DLQ**: none (not configured with `x-dead-letter-*`).
- **Publishers**: None wired.
- **Consumer(s)**: None wired (queue is declared but no `queue.iterator()` loop attaches to it).
- **Message kinds**: n/a (reserved for the v2 parent-export workflow).
- **Prefetch / priority**: n/a.
- **Purpose**: Placeholder for v2 chat-export parent orchestration (multi-thread bundle); declaration shipped ahead of consumer code.

### `q.export.chat.merge`

- **Declared**: `workers/chat-export-worker/main.py:112-113`.
- **Routing key**: `q.export.chat.merge`
- **DLQ**: none.
- **Publishers**: None wired.
- **Consumer(s)**: None wired.
- **Message kinds**: n/a (reserved for v2 merge step).
- **Prefetch / priority**: n/a.
- **Purpose**: Placeholder for v2 chat-export merge step.

### `storage.toggle`

- **Declared**: `services/storage_toggle_worker/main.py:110` and `api-gateway/routes/admin_storage.py:217`. Uses the **default exchange** (`""`), NOT `tm.exchange`.
- **Routing key**: `storage.toggle`
- **DLQ**: none.
- **Publishers**: `api-gateway/routes/admin_storage.py:218-230` — admin storage-backend toggle endpoint.
- **Consumer(s)**: `services/storage_toggle_worker/main.py:112` (`storage_toggle_worker`); no explicit prefetch override.
- **Message kinds**: `{event_id, from_id, to_id, actor_id, reason}`.
- **Prefetch / priority**: default channel QoS; `aio_pika.DeliveryMode.PERSISTENT`.
- **Purpose**: Admin-initiated swap between storage backends; serialized by a Postgres advisory lock in the worker.

### DLQ family (auto-declared by `_declare_queue`)

For every queue declared via `MessageBus._declare_queue()`, a sibling `<queue>.dlq` is created with binding `<routing_key>.dlq`. These are durable, but carry no `x-dead-letter-*` themselves (terminal). Active DLQ consumers exist only for backup lanes:

- `backup.urgent.dlq`, `backup.high.dlq`, `backup.normal.dlq`, `backup.low.dlq` are consumed by `services/backup-scheduler/main.py:2603-2657` (`consume_one`), which writes an `Alert(type=BACKUP_DLQ, severity=HIGH)` row per poison message and ACKs to prevent infinite re-rejection.

All other DLQs (`backup.heavy.dlq`, `restore.*.dlq`, partition DLQs, `discovery.*.dlq`, `azure.*.dlq`, `audit.events.dlq`, etc.) have no automated consumer and accumulate until an operator drains them.

### Routing-fence virtual queue map

`shared/routing_fence.py:33-48` defines `_QUEUE_BY_WORKLOAD` — used by `reroute_or_dlq` to forward wrong-queue messages. Notable: it maps `USER_CHATS` and `USER_ONEDRIVE` workloads to `backup.heavy`, which is consistent with `pick_backup_queue` decisions.

## Message factories

All factories live in `tm_backend/shared/message_bus.py`.

### `create_backup_message`

- **Location**: `shared/message_bus.py:251`
- **Signature**: `create_backup_message(job_id, resource_id, tenant_id, full_backup=False) -> dict`
- **Output shape**: `{jobId, resourceId, tenantId, type ("FULL"|"INCREMENTAL"), priority (1 if FULL else 5), createdAt}`
- **Used by**: `services/job-service/main.py:1617,1754` (manual single-resource trigger paths) and as the per-resource body in fan-out paths.
- **Routed to**: `backup.urgent`, `backup.heavy`, or one of the `azure.*` queues (resolved by `pick_backup_queue` / `AZURE_WORKLOAD_QUEUES`).

### `create_mass_backup_message`

- **Location**: `shared/message_bus.py:447`
- **Signature**: `create_mass_backup_message(job_id, tenant_id, resource_type, resource_ids, sla_policy_id=None, full_backup=False) -> dict`
- **Output shape**: `{jobId, tenantId, resourceType, resourceIds[], type, priority, slaPolicyId, triggeredBy ("SCHEDULED"), snapshotLabel ("scheduled"), forceFullBackup, createdAt, batchSize}`
- **Used by**: `services/backup-scheduler/main.py:1896` (`dispatch_policy_backups`), `:2160` (preemptive tenant fanout); `services/job-service/main.py:582` (batch trigger).
- **Routed to**: `backup.urgent`, `backup.high`, `backup.normal`, `backup.heavy`, or `backup.low` depending on caller.

### `create_chats_partition_message`

- **Location**: `shared/message_bus.py:262`
- **Signature** (kwargs-only): `partition_id, snapshot_id, job_id, tenant_id, resource_id, chat_ids`
- **Output shape**: `{messageType: "BACKUP_CHATS_PARTITION", partitionId, snapshotId, jobId, tenantId, resourceId, chatIds[], createdAt}`
- **Used by**: `workers/backup-worker/main.py:10103` (chats coordinator) and `services/backup-scheduler/main.py:918` (partition stale sweep).
- **Routed to**: `backup.chats_partition`.

### `create_mail_partition_message`

- **Location**: `shared/message_bus.py:293`
- **Signature** (kwargs-only): `partition_id, snapshot_id, job_id, tenant_id, resource_id, folder_ids, resource_type="USER_MAIL"`
- **Output shape**: `{messageType: "BACKUP_MAIL_PARTITION", partitionId, snapshotId, jobId, tenantId, resourceId, folderIds[], resourceType, createdAt}`
- **Used by**: `workers/backup-worker/main.py:9973` and `services/backup-scheduler/main.py:933`.
- **Routed to**: `backup.mail_partition`. Covers all four mailbox resource types.

### `create_sharepoint_partition_message`

- **Location**: `shared/message_bus.py:325`
- **Signature** (kwargs-only): `partition_id, snapshot_id, job_id, tenant_id, resource_id, drive_ids, site_id`
- **Output shape**: `{messageType: "BACKUP_SHAREPOINT_PARTITION", partitionId, snapshotId, jobId, tenantId, resourceId, driveIds[], siteId, createdAt}`
- **Used by**: `workers/backup-worker/main.py:10304` and `services/backup-scheduler/main.py:952`.
- **Routed to**: `backup.sharepoint_partition`.

### `create_groups_partition_message`

- **Location**: `shared/message_bus.py:354`
- **Signature** (kwargs-only): `partition_id, snapshot_id, job_id, tenant_id, resource_id, channel_ids, team_id`
- **Output shape**: `{messageType: "BACKUP_GROUPS_PARTITION", partitionId, snapshotId, jobId, tenantId, resourceId, channelIds[], teamId, createdAt}`
- **Used by**: `workers/backup-worker/main.py:10446`.
- **Routed to**: `backup.groups_partition`. `team_id` mirrors the role `site_id` plays for SharePoint partitions so consumers can scope the drain even when the M365_GROUP path supplies a proxy resource.

### `create_entra_partition_message`

- **Location**: `shared/message_bus.py:386`
- **Signature** (kwargs-only): `partition_id, snapshot_id, job_id, tenant_id, resource_id, category_ids, directory_id`
- **Output shape**: `{messageType: "BACKUP_ENTRA_PARTITION", partitionId, snapshotId, jobId, tenantId, resourceId, categoryIds[], directoryId, createdAt}`
- **Used by**: `workers/backup-worker/main.py:10598`.
- **Routed to**: `backup.entra_partition`. `categoryIds` is one of `USERS / GROUPS / ROLES / SECURITY / AUDIT / APPLICATIONS / INTUNE / ADMIN_UNITS`.

### `create_onedrive_partition_message`

- **Location**: `shared/message_bus.py:419`
- **Signature** (kwargs-only): `partition_id, snapshot_id, job_id, tenant_id, resource_id, drive_id`
- **Output shape**: `{messageType: "BACKUP_ONEDRIVE_PARTITION", partitionId, snapshotId, jobId, tenantId, resourceId, driveId, createdAt}`
- **Used by**: `workers/backup-worker/main.py:9780` and `services/backup-scheduler/main.py:905`.
- **Routed to**: `backup.onedrive_partition`. The consumer reads `file_ids` from the `snapshot_partitions` row (not the message) to keep the envelope small.

### `create_restore_message`

- **Location**: `shared/message_bus.py:482`
- **Signature**: `create_restore_message(job_id, restore_type="IN_PLACE", snapshot_ids=None, item_ids=None, resource_id=None, tenant_id=None, spec=None, resource_type=None) -> dict`
- **Output shape**: `{jobId, restoreType, resourceType, snapshotIds[], itemIds[], resourceId, tenantId, spec, type: "RESTORE", priority, queue, createdAt}`
- **Internal routing**: maps `restore_type → queue`:
  - `IN_PLACE / CROSS_RESOURCE / EXPORT_PST → restore.normal`
  - `CROSS_USER → restore.urgent`
  - `EXPORT_ZIP / DOWNLOAD → restore.low`
  - `resource_type` in `AZURE_RESTORE_QUEUE_BY_TYPE` overrides to `azure.restore.*`
  - whale-traffic override: `spec.totalBytes >= threshold` switches normal/low to `restore.heavy` via `pick_restore_queue` / `pick_export_queue`
- **Priority map**: `IN_PLACE=5, CROSS_USER=3, CROSS_RESOURCE=4, EXPORT_PST=6, EXPORT_ZIP=7, DOWNLOAD=8`
- **Used by**: `services/job-service/main.py:2091,2236` and several restore-trigger endpoints.

### `create_discovery_message`

- **Location**: `shared/message_bus.py:556`
- **Signature**: `create_discovery_message(tenant_id, tenant_type) -> dict`
- **Output shape**: `{tenantId, type, createdAt}`
- **Used by**: declared but no in-tree publisher calls it directly — `auth-service`, `tenant-service`, and `backup-scheduler` build the discovery envelope inline with extra fields (`jobId`, `externalTenantId`, `discoveryScope`, `triggeredBy`, `triggeredAt`). Factory kept for API stability.

### `create_notification_message`

- **Location**: `shared/message_bus.py:564`
- **Signature**: `create_notification_message(alert_id, severity, message) -> dict`
- **Output shape**: `{alertId, severity, message, createdAt}`
- **Used by**: no in-tree publisher; would target the (currently inactive) `notification` queue.

### `create_audit_event_message`

- **Location**: `shared/message_bus.py:573`
- **Signature**: `create_audit_event_message(action, tenant_id, org_id=None, actor_type="SYSTEM", actor_id=None, actor_email=None, resource_id=None, resource_type=None, resource_name=None, outcome="SUCCESS", job_id=None, snapshot_id=None, details=None) -> dict`
- **Output shape**: `{action, tenantId, orgId, actorType, actorId, actorEmail, resourceId, resourceType, resourceName, outcome, jobId, snapshotId, details, createdAt}`
- **Used by**: `services/backup-scheduler/main.py:344` (`publish_sla_skip_audit_events`) and other audit emit sites via `audit_message = create_audit_event_message(...)` patterns. Consumed by `services/audit-service/main.py:2803` and persisted as `AuditEvent` rows.
- **Routed to**: `audit.events`.

## Companion constants

- `AZURE_RESTORE_QUEUE_BY_TYPE` (`shared/message_bus.py:472`) — used by `create_restore_message` to map Azure resource types to their dedicated restore queues.
- `AZURE_WORKLOAD_QUEUES` (`services/job-service/main.py:44`, `services/backup-scheduler/main.py:146`) — publisher-side map from Azure resource type → backup queue.
- `_PARTITION_QUEUE_BY_TYPE` + `_MESSAGE_TYPE_BY_PARTITION_TYPE` (`shared/reconciler.py:440-461`) — mirror of partition routing used by the orphan-partition republish path.
- `_QUEUE_BY_WORKLOAD` (`shared/routing_fence.py:33`) — mirror used by `reroute_or_dlq` for wrong-queue corrections.
