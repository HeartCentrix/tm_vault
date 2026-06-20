# TMvault — Comprehensive Environment Variable Catalog

Source-of-truth sweep across:
- `tm_backend/shared/config.py` (Pydantic-style `Settings` class — every attribute is an env var)
- All `os.getenv(...)`, `os.environ[...]`, `os.environ.get(...)` references across `tm_backend/` (services, workers, shared, scripts, alembic)
- All `import.meta.env.*` and `process.env.*` references across `tm_vault/` (frontend + e2e)

Notes:
- "Required" = no default supplied — fails closed or raises.
- "Computed" = derived from other env vars / properties (e.g. `RABBITMQ_URL` is built from `RABBITMQ_USER/PASSWORD/HOST/PORT`).
- Defaults are shown verbatim as written in code (so `str(5 * 1024 * 1024 * 1024)` is 5 GiB).
- "Where Used" lists one canonical site; many vars are read in more files.

---

## 1. Database (Postgres + asyncpg + SQLAlchemy)

| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `DATABASE_URL` | — (optional override) | str | shared/config.py:786 | Full Postgres DSN; overrides DB_HOST/PORT/NAME/USERNAME/PASSWORD. Accepts `postgres://`, `postgresql://`, `postgresql+asyncpg://`. |
| `DB_HOST` | `localhost` (config) / required if no DATABASE_URL | str | shared/config.py:20 | Postgres host. Also accepts a full DSN pasted here. |
| `DB_PORT` | `5432` | str | shared/config.py:21 | Postgres port. |
| `DB_NAME` | required (no default) | str | shared/config.py:22 | Postgres database name. |
| `DB_USERNAME` | required | str | shared/config.py:23 | Postgres user. |
| `DB_USER` | `postgres` (fallback when DB_USERNAME unset) | str | shared/storage/startup.py:34 | Legacy alias for DB_USERNAME used in storage bootstrap. |
| `DB_PASSWORD` | required | str | shared/config.py:24 | Postgres password. |
| `DB_SCHEMA` | `public` (or `tm` in admin route) | str | shared/config.py:26 | Postgres schema in use. |
| `DB_POOL_SIZE` | `30` | int | shared/config.py:55 | SQLAlchemy steady-state pool size per process. |
| `DB_MAX_OVERFLOW` | `20` | int | shared/config.py:56 | Burst overflow slots above pool size. |
| `DB_POOL_TIMEOUT` | `30` | int | shared/config.py:57 | Seconds to wait for a pool slot before raising. |
| `DB_POOL_RECYCLE` | `1800` | int | shared/config.py:58 | Recycle (close) idle connection after N seconds. |
| `DB_POOL_USE_LIFO` | `true` | bool | shared/config.py:59 | LIFO checkout — newest idle conn first. |
| `STATEMENT_CACHE_SIZE` | `0` | int | shared/database.py:103 | asyncpg prepared-statement cache; 0 disables (PgBouncer-safe). |
| `POSTGRES_MAX_CONNECTIONS` | — | int | (docs/comment only) | Tunable on the PG service itself (not the app); referenced in config.py:47 comment. |
| `DR_PG_DSN` | `""` | str | services/dr-replication-worker/main.py:573 | DSN of the DR-replica Postgres for cross-region chat replication. |
| `DR_CHAT_REPL_INTERVAL_S` | `600` | int | services/dr-replication-worker/main.py:574 | Seconds between DR chat replication cycles. |
| `ALEMBIC_FORCE_PARTITIONING` | — | bool ("1") | alembic/versions/20260517_0002_partition_big_tables.py:124 | Override the partitioning migration safety guard. |
| `ALEMBIC_DRAIN_CHECK_SKIP` | — | bool ("1") | alembic/versions/20260517_0002_partition_big_tables.py:129 | Skip the worker-drain precondition. |
| `ALEMBIC_BACKUP_TAKEN` | — | bool ("1") | alembic/versions/20260517_0002_partition_big_tables.py:139 | Operator-attested pg_dump backup taken before partition migration. |
| `ALEMBIC_DISK_HEADROOM_OK` | — | bool ("1") | alembic/versions/20260517_0002_partition_big_tables.py:149 | Operator-attested ≥2× disk headroom for partition migration. |
| `ALEMBIC_WAL_TUNED` | — | bool ("1") | alembic/versions/20260517_0002_partition_big_tables.py:158 | Operator-attested WAL tuning done. |
| `LAST_PG_DUMP_PATH` | — | str | scripts/pre_migration_check.py:136 | Path to most recent pg_dump (read by pre-migration check). |

---

## 2. RabbitMQ

| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `RABBITMQ_URL` | — | str | shared/config.py:144 | Full AMQP URL (e.g. `amqp://user:pass@host:5672/vhost`); overrides individual host/port/user/pass vars. |
| `AMQP_URL` | — | str | shared/config.py:144 | Alias for RABBITMQ_URL. |
| `RABBITMQ_HOST` | `localhost` | str | shared/config.py:155 | Broker host. |
| `RABBITMQ_PORT` | `5672` | int | shared/config.py:156 | Broker port. |
| `RABBITMQ_USER` | `""` | str | shared/config.py:158 | Username (fallback for USERNAME). |
| `RABBITMQ_USERNAME` | `""` | str | shared/config.py:158 | Preferred username env name. |
| `RABBITMQ_PASSWORD` | `""` | str | shared/config.py:160 | Broker password. Refuses guest:guest. |
| `RABBITMQ_ENABLED` | `false` | bool | shared/config.py:161 | Master switch for RMQ-dependent paths. |
| `RABBITMQ_CONSUMER_HEARTBEAT_SECONDS` | `7*24*3600` (7d) | int | shared/config.py:592 | aio-pika heartbeat; tolerates long-running consumers. |
| `RABBITMQ_CONSUMER_TIMEOUT_MS` | `7*24*3600*1000` (7d) | int | shared/config.py:593 | Server-side consumer ack-timeout (ms). |
| `RABBITMQ_MGMT_USER` | `guest` | str | services/autoscaler/main.py:257 | RabbitMQ Management API user (autoscaler poll). |
| `RABBITMQ_MGMT_PASSWORD` | `guest` | str | services/autoscaler/main.py:258 | RabbitMQ Management API password. |
| `BACKUP_WORKER_QUEUE` | `backup.normal` | str | shared/config.py:577 | Queue name for normal backup work. |
| `BACKUP_HEAVY_QUEUE` | `backup.heavy` | str | shared/config.py:576 | Queue name for whale-OneDrive backups. |
| `BACKUP_HEAVY_ENABLED` | `true` | bool | shared/config.py:574 | Route oversize OneDrives to backup.heavy. |
| `BACKUP_HEAVY_THRESHOLD_BYTES` | `100 GiB` | int | shared/config.py:575 | Drive size above which backup routes to heavy queue. |
| `RESTORE_WORKER_QUEUE` | `restore.normal` | str | shared/config.py:690 | Restore-worker default queue. |
| `HEAVY_EXPORT_QUEUE` | `restore.heavy` | str | shared/config.py:686 | Restore-worker heavy-export queue. |
| `HEAVY_EXPORT_ENABLED` | `true` | bool | shared/config.py:689 | Route oversize exports to restore.heavy. |
| `HEAVY_EXPORT_THRESHOLD_BYTES` | `100 GiB` | int | shared/config.py:683 | Bytes threshold for routing to restore.heavy. |
| `HEAVY_RESTORE_THRESHOLD_BYTES` | `20 GiB` | int | shared/export_routing.py:67 | Restore-side heavy threshold (independent from export). |
| `BACKUP_URGENT_PREFETCH` | `8` | int | workers/backup-worker/main.py:2123 | Per-consumer prefetch on backup.urgent. |
| `BACKUP_HIGH_PREFETCH` | `10` | int | workers/backup-worker/main.py:2124 | Per-consumer prefetch on backup.high. |
| `BACKUP_NORMAL_PREFETCH` | `20` | int | workers/backup-worker/main.py:2125 | Per-consumer prefetch on backup.normal. |
| `BACKUP_LOW_PREFETCH` | `50` | int | workers/backup-worker/main.py:2126 | Per-consumer prefetch on backup.low. |
| `BACKUP_CHATS_PARTITION_PREFETCH` | `12` | int | workers/backup-worker/main.py:2150 | Prefetch on chats-partition lane. |
| `BACKUP_MAIL_PARTITION_PREFETCH` | `4` | int | workers/backup-worker/main.py:2157 | Prefetch on mail-partition lane. |
| `BACKUP_SP_PARTITION_PREFETCH` | `2` | int | workers/backup-worker/main.py:2164 | Prefetch on SharePoint-partition lane. |
| `BACKUP_GROUPS_PARTITION_PREFETCH` | `4` | int | workers/backup-worker/main.py:2172 | Prefetch on groups/teams-partition lane. |
| `BACKUP_ENTRA_PARTITION_PREFETCH` | `4` | int | workers/backup-worker/main.py:2180 | Prefetch on entra-partition lane. |
| `BACKUP_FANOUT_PUBLISH_CHUNK` | `200` | int | workers/backup-worker/main.py:3599 | Messages per publish-batch when fanning out tasks. |
| `BACKUP_GROUP_TIMEOUT_S` | `86400` (24h) | int | workers/backup-worker/main.py:3370 | Top-level snapshot-group timeout. |

---

## 3. Redis

| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `REDIS_URL` | — | str | shared/config.py:111 | Full Redis URL (e.g. `rediss://:password@host:6379`). |
| `REDIS_HOST` | `localhost` | str | shared/config.py:120 | Redis host. |
| `REDIS_PORT` | `6379` | int | shared/config.py:121 | Redis port. |
| `REDIS_DB` | `0` | int | shared/config.py:122 | Redis DB index. |
| `REDIS_PASSWORD` | `""` | str | shared/config.py:123 | Redis password. |
| `REDIS_USERNAME` | `""` | str | shared/config.py:124 | Redis username (ACL). |
| `REDIS_ENABLED` | `false` | bool | shared/config.py:125 | Master Redis switch. |

---

## 4. Storage — Azure Blob

| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `AZURE_STORAGE_ACCOUNT_NAME` | `""` | str | shared/config.py:162 | Primary Azure storage account. |
| `AZURE_STORAGE_ACCOUNT_KEY` | `""` | str | shared/config.py:163 | Account key. |
| `AZURE_STORAGE_BLOB_ENDPOINT` | `https://blob.core.windows.net` | str | shared/config.py:164 | Blob endpoint base. |
| `STORAGE_SHARD_COUNT` | `1` | int | shared/config.py:211 | Count of storage accounts to shard across. |
| `STORAGE_SHARD_ACCOUNTS` | `""` (csv→list) | list[str] | shared/config.py:213 | Comma-sep account names. |
| `STORAGE_SHARD_KEYS` | `""` (csv→list) | list[str] | shared/config.py:216 | Comma-sep account keys (positional match). |
| `AZURE_BLOCK_SIZE_MB` | `100` | int | shared/config.py:224 | Block size for blob uploads (MB). |
| `AZURE_UPLOAD_CONCURRENCY` | `5` | int | shared/config.py:226 | Concurrent block uploads per file. |
| `ACTIVE_STORAGE_BACKEND` | `""` (lowercased) | str | shared/azure_storage.py:792 | Selects active storage backend at runtime. |
| `STORAGE_DEFAULT_BACKEND` | `azure-primary` | str | shared/storage_bootstrap.py:275 | Default backend name in storage_backends table. |
| `STORAGE_BOOTSTRAP_LOCK_DEADLINE_S` | `5` | float | shared/storage_bootstrap.py:187 | Lock deadline for bootstrap routine. |
| `STORAGE_BUCKET_ENSURE_ATTEMPTS` | `5` | int | shared/storage_bootstrap.py:356 | Retries to ensure bucket existence. |
| `STORAGE_BUCKET_ENSURE_BACKOFF_S` | `4` | float | shared/storage_bootstrap.py:357 | Backoff between bucket-ensure retries. |
| `STORAGE_FACADE_LOG_FALLBACKS` | `false` | bool | shared/azure_storage.py:858 | Log when facade falls back to legacy path. |
| `STORAGE_ROUTER_STRICT` | `false` | bool | shared/azure_storage.py:868 | Strict-mode router; fail closed on missing backend. |
| `STORAGE_ROUTER_MAX_RETRIES` | `12` | int | shared/storage/startup.py:58 | Startup retries for router DB lookup. |
| `STORAGE_ROUTER_BACKOFF_BASE_S` | `1.0` | float | shared/storage/startup.py:59 | Router startup backoff base. |
| `STORAGE_ROUTER_BACKOFF_CAP_S` | `10.0` | float | shared/storage/startup.py:60 | Router startup backoff cap. |

---

## 5. Storage — SeaweedFS / On-prem S3

| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `ONPREM_S3_ENDPOINT` | `""` (or `http://seaweedfs:8333`) | str | shared/config.py:167 / shared/storage_bootstrap.py:101 | SeaweedFS / S3 endpoint URL. |
| `ONPREM_S3_ACCESS_KEY` | `""` | str | shared/config.py:168 | S3 access key. |
| `ONPREM_S3_SECRET_KEY` | `""` | str | shared/config.py:169 | S3 secret key. |
| `ONPREM_S3_BUCKETS` | `""` (csv→list) | list[str] | shared/config.py:170 | Comma-sep bucket list. |
| `ONPREM_S3_REGION` | `us-east-1` | str | shared/config.py:172 | Region (signing). |
| `ONPREM_S3_VERIFY_TLS` | `true` | bool | shared/config.py:173 | Verify TLS cert on S3 calls. |
| `ONPREM_S3_CA_BUNDLE` | `""` (None) | str | shared/config.py:174 | Custom CA bundle path. |
| `ONPREM_UPLOAD_CONCURRENCY` | `16` | int | shared/config.py:182 | Multipart parts in flight per upload. (Deployed: 96 on heavy worker.) |
| `ONPREM_MULTIPART_THRESHOLD_MB` | `100` | int | shared/config.py:183 | Size at which multipart upload is used. |
| `ONPREM_RETRY_MAX` | `3` | int | shared/config.py:184 | Retries on S3 calls. |

### S3 client timeouts (worker → SeaweedFS) — `shared/storage/seaweedfs.py`
Bounded so a slow/down/restarting SeaweedFS server **fails fast → per-file retry queue** instead of hanging the drain coroutine (a hung upload would hold the partition lease and stall the snapshot forever). See `SEAWEEDFS_SHARDING.md`.

| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `ONPREM_S3_CONNECT_TIMEOUT_S` | `10` | int | shared/storage/seaweedfs.py | Connect timeout; fail fast if a vol server is unreachable. |
| `ONPREM_S3_READ_TIMEOUT_S` | `120` | int | shared/storage/seaweedfs.py | Per-request read timeout. |
| `ONPREM_S3_MAX_ATTEMPTS` | `3` | int | shared/storage/seaweedfs.py | botocore retry attempts (standard mode). |
| `ONPREM_S3_MAX_POOL` | `256` | int | shared/storage/seaweedfs.py | S3 connection-pool size (default 10 stalls at high file-concurrency). |

### SeaweedFS sharded cluster — coordinator + volume-server services
On-prem storage is a **sharded cluster**: one volume-less coordinator (`weed master+filer+s3`) + N volume-server services (`weed volume`), each with its own Railway volume. **Full architecture + DR/rebuild steps: `SEAWEEDFS_SHARDING.md`.** These vars are set on the SeaweedFS container services (not `config.py`).

| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `SEAWEED_MASTER` | — (required) | str | deploy/railway/seaweedfs-volume/entrypoint.sh | Master address each vol server registers with (`seaweedfs.railway.internal:9333`). |
| `SEAWEED_VOLUME_MAX` | `100` | int | deploy/railway/seaweedfs-volume/entrypoint.sh | Max volumes a vol server may host (disk is the real cap). |
| `SEAWEED_VOLUME_SIZE_LIMIT_MB` | `30000` | int | deploy/railway/seaweedfs/entrypoint.sh | Per-volume rollover (coordinator). Deployed `5000` ⇒ 5 GB volumes ⇒ even cross-server spread. |
| `SEAWEED_ADVERTISE_IP` | `RAILWAY_PRIVATE_DOMAIN` | str | deploy/railway/seaweedfs-volume/entrypoint.sh | Advertised host; entrypoint binds `0.0.0.0` (`-ip.bind`) to avoid gRPC bind crash-loop. |
| `SEAWEED_VOLUME_PORT` | `8080` | int | deploy/railway/seaweedfs-volume/entrypoint.sh | Volume HTTP port (gRPC = +10000). |
| `GOMEMLIMIT` | — | str | seaweedfs + vol-server services | Go heap soft-cap (deployed `18GiB`). |
| `GOGC` | `100` | int | seaweedfs + vol-server services | GC aggressiveness (deployed `50`). |

---

## 6. Microsoft Graph & M365 Apps

| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `GRAPH_APP_MAX` | `30` | int | shared/config.py:820 | Max APP_<N>_* slots scanned at startup. |
| `APP_<N>_CLIENT_ID` (1..30) | `""` | str | shared/config.py:823/827 | Per-app client id (sparse-tolerant). |
| `APP_<N>_CLIENT_SECRET` (1..30) | `""` | str | shared/config.py:824/828 | Per-app client secret. |
| `APP_<N>_TENANT_ID` (1..30) | `common` | str | shared/config.py:825/829 | Per-app tenant id. |
| `APP_1_CLIENT_ID` | — | str | scripts/probe_expand_hypothesis.py:33 | Explicit slot-1 client id (covered by APP_<N>_*; used by probe scripts directly). |
| `APP_1_CLIENT_SECRET` | — | str | scripts/probe_expand_hypothesis.py:34 | Explicit slot-1 client secret. |
| `APP_1_TENANT_ID` | — | str | scripts/probe_expand_hypothesis.py:35 | Explicit slot-1 tenant id. |
| `AZURE_AD_CLIENT_ID` | — | str | shared/config.py:823 | Legacy single-app fallback for APP_1. |
| `AZURE_AD_CLIENT_SECRET` | — | str | shared/config.py:824 | Legacy single-app fallback for APP_1. |
| `AZURE_AD_TENANT_ID` | `common` | str | shared/config.py:825 | Legacy single-app fallback for APP_1. |
| `MICROSOFT_AUTH_URL` | derived | str | shared/config.py:756 | OAuth authorize endpoint (from tenant id). |
| `MICROSOFT_TOKEN_URL` | derived | str | shared/config.py:757 | OAuth token endpoint. |
| `DATASOURCE_AUTH_URL` | `…/organizations/oauth2/v2.0/authorize` | str | shared/config.py:767 | Multi-tenant OAuth for connecting other orgs. |
| `DATASOURCE_TOKEN_URL` | `…/organizations/oauth2/v2.0/token` | str | shared/config.py:768 | Multi-tenant token endpoint. |
| `POWER_BI_CLIENT_ID` | `""` | str | shared/config.py:761 | Optional Power BI / Fabric dedicated app. |
| `POWER_BI_CLIENT_SECRET` | `""` | str | shared/config.py:762 | Power BI app secret. |
| `POWER_BI_TENANT_ID` | `""` | str | shared/config.py:763 | Power BI tenant id. |
| `POWER_BI_FULL_SNAPSHOT_DAYS` | `7` | int | shared/config.py:764 | Days between Power BI full snapshots. |
| `SHAREPOINT_CERT_PATH` | — | str | shared/graph_client.py:2784 | Cert-auth path for SharePoint-only flow. |
| `SHAREPOINT_CERT_PEM_B64` | — | str | shared/graph_client.py:2783 | Base64-encoded SP cert PEM. |
| `SHAREPOINT_CERT_THUMBPRINT` | — | str | shared/graph_client.py:2785 | SP cert thumbprint override. |
| `AZURE_ARM_CLIENT_ID` | `""` | str | shared/config.py:188 | Azure ARM SP for VM/SQL/PG backup. |
| `AZURE_ARM_CLIENT_SECRET` | `""` | str | shared/config.py:189 | ARM SP secret. |
| `AZURE_ARM_TENANT_ID` | `""` | str | shared/config.py:190 | ARM SP tenant. |
| `AZURE_SUBSCRIPTION_ID` | `""` | str | shared/config.py:191 | Azure subscription. |
| `AZURE_BACKUP_RESOURCE_GROUP` | `rg-tmvault-backup` | str | shared/config.py:194 | RG for VM restore-point collections. |
| `AZURE_BACKUP_REGION` | `eastus` | str | shared/config.py:196 | Region for RPC placement. |

### Graph throttling & hardening

| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `GRAPH_HARDENING_ENABLED` | `true` | bool | shared/config.py:597 | Master switch for Graph hardening (backoff ladder, multi-app rotate). |
| `GRAPH_APP_PACE_REQS_PER_SEC` | `40.0` | float | shared/config.py:616 | Per-(app,tenant) sustained RPS cap. |
| `GRAPH_STREAM_PACE_REQS_PER_SEC` | `2.0` | float | shared/config.py:623 | Per-stream (concurrent backup) RPS cap. |
| `GRAPH_PRIORITY_SCHEDULING_ENABLED` | `true` | bool | shared/config.py:632 | Enable HIGH/URGENT bypass on rate limiter. |
| `GRAPH_MAX_RETRIES` | `5` | int | shared/config.py:635 | Max Graph retries on transient errors. |
| `GRAPH_THROTTLE_BACKOFF_SECONDS` | `10,30,60,180,300` | list[int] | shared/config.py:647 | Backoff ladder on 429/503 w/o Retry-After. |
| `GRAPH_TRANSIENT_BACKOFF_SECONDS` | `2,4,8,16,32` | list[int] | shared/config.py:653 | Backoff ladder on transient network errors. |
| `GRAPH_JITTER_RATIO` | `0.2` | float | shared/config.py:658 | Jitter ratio on backoff. |
| `GRAPH_POST_THROTTLE_BRAKE_MS` | `250` | int | shared/config.py:664 | Safety brake after a 429 before next call (ms). |
| `GRAPH_MAX_CUMULATIVE_WAIT_SECONDS` | `14400` (4h) | int | shared/config.py:669 | Hard cap on cumulative wait per stream. |
| `GRAPH_MAX_THROTTLE_WAIT_SECONDS` | `1800` (30m) | int | shared/config.py:673 | Clamp when ALL apps throttled. |
| `GRAPH_STICKY_PAGES_BEFORE_RETURN` | `50` | int | shared/config.py:676 | Pages handled on a sticky app before yielding. |
| `GRAPH_BATCH_MAX_SIZE` | `20` | int | shared/config.py:679 | Graph $batch endpoint max sub-requests. |
| `GRAPH_BATCH_SIZE` | `20` | int | shared/config.py:235 | Default batch size for Graph $batch usage. |
| `GRAPH_RATE_LIMITER_ENABLED` | `true` | bool | shared/graph_rate_limiter.py:181 | Enable global token-bucket limiter. |
| `GRAPH_GLOBAL_RPS` | `200` | float | shared/graph_rate_limiter.py:182 | Global token-bucket refill rate. |
| `GRAPH_GLOBAL_BURST` | `400` | float | shared/graph_rate_limiter.py:183 | Global token-bucket burst capacity. |
| `GRAPHCLIENT_HTTP2` | `true` | bool | shared/graph_client.py:147 | Use HTTP/2 in the Graph client. |
| `SHARED_URL_STREAM_MAX_RESUMES` | `6` | int | shared/graph_client.py:4268 | Max stream-resume attempts on pre-signed Graph URLs. |

---

## 7. Worker tuning — concurrency, timeouts, fanout

### Backup-worker / Graph-side concurrency
| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `BACKUP_CONCURRENCY` | `100` | int | shared/config.py:203 | Max concurrent Graph calls per worker replica. |
| `COPY_CONCURRENCY` | `100` | int | shared/config.py:205 | Max concurrent server-side-copy ops. |
| `SERVER_SIDE_COPY_THRESHOLD` | `10485760` (10 MB) | int | shared/config.py:207 | File size above which server-side-copy is used. |
| `WORKLOAD_CONCURRENCY` | `5` | int | shared/config.py:209/229 | Parallel jobs per workload type / parallel RGs. |
| `MAX_RETRIES` | `5` | int | shared/config.py:219 | Generic retry budget. |
| `RETRY_DELAY_MS` | `2000` | int | shared/config.py:230 | Initial retry delay (ms). |
| `RETRY_BACKOFF_MULTIPLIER` | `2.0` | float | shared/config.py:231 | Exponential retry multiplier. |
| `RESOURCE_CHUNK_SIZE` | `50` | int | shared/config.py:237 | Chunk size when iterating resources. |
| `DISCOVERY_STAGE_CHUNK_SIZE` | `500` | int | shared/config.py:239 | Discovery staging batch size. |
| `DISCOVERY_PROGRESS_LOG_EVERY` | `250` | int | shared/config.py:240 | Log every N rows during discovery. |
| `BULK_INSERT_CHUNK` | `2000` | int | workers/backup-worker/main.py:75 | Bulk-insert chunk size. |
| `INLINE_ATTACHMENT_MAX_BYTES` | `262144` (256 KB) | int | workers/backup-worker/main.py:94 | Threshold below which attachments are inlined. |

### Mailbox backup
| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `MAILBOX_PARALLEL_FOLDERS` | `10` | int | workers/backup-worker/main.py:15330 | Concurrent mail folders per mailbox. |
| `MAILBOX_TIMEOUT_S` | `43200` (12h) | int | workers/backup-worker/main.py:15331 | Per-mailbox total backup timeout. |
| `USER_MAIL_PARALLEL_FOLDERS` | `10` | int | workers/backup-worker/main.py:3848 | Concurrent folders for USER_MAIL handler. |
| `USER_MAIL_TIMEOUT_S` | `43200` | int | workers/backup-worker/main.py:3851 | USER_MAIL timeout. |
| `USER_MAIL_FULL_RESCAN_DAYS` | `3` | int | workers/backup-worker/main.py:3904 | Force full rescan if last delta > N days old. |
| `USER_MAIL_ATT_CONCURRENCY` | `8` | int | workers/backup-worker/main.py:7958 | Attachment download concurrency per user. |
| `USER_MAIL_UPLOAD_CONCURRENCY` | `32` | int | workers/backup-worker/main.py:7964 | Attachment upload concurrency. |
| `USER_MAIL_ATT_BATCH` | `20` | int | workers/backup-worker/main.py:8052 | Attachments per $batch call. |

### Chats backup
| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `USER_CHATS_PARALLEL_CHATS` | `32` | int | workers/backup-worker/main.py:5386 | Concurrent chats per user. |
| `USER_CHATS_TIMEOUT_S` | `43200` | int | workers/backup-worker/main.py:5389 | Per-user chat backup timeout. |
| `USER_CHATS_APP_SHARDS` | `0` | int | workers/backup-worker/main.py:5403 | Shard a user's chats across N apps (0=auto). |
| `USER_CHATS_FULL_RESCAN_DAYS` | `3` | int | workers/backup-worker/main.py:4950 | Force full chat rescan after N days. |
| `USER_CHATS_ATTACHMENT_CONCURRENCY` | `16` | int | workers/backup-worker/main.py:8583 | Concurrent chat attachment downloads. |
| `CHAT_THREAD_DRAIN_FRESHNESS_S` | `25200` (7h) | int | workers/backup-worker/main.py:452 | Skip thread re-drain if drained within window. |
| `CHAT_DRAIN_RETRIES` | `4` | int | workers/backup-worker/main.py:6285 | Retry budget for chat thread drains. |
| `CHAT_HC_MSG_CONCURRENCY` | `16` | int | workers/backup-worker/main.py:7556 | Per-message hostedContent concurrency. |
| `CHAT_HC_DOWNLOAD_CONCURRENCY` | `32` | int | workers/backup-worker/main.py:8598 | hostedContents parallel downloads. |
| `CHAT_HC_UPLOAD_CONCURRENCY` | `32` | int | workers/backup-worker/main.py:8601 | hostedContents parallel uploads. |
| `CHAT_URL_CACHE_TTL_DAYS` | `30` | int | workers/backup-worker/main.py:8767 | TTL on chat-attachment URL cache rows. |
| `CHAT_HOSTED_CONTENT_CONCURRENCY` | `8` | int | shared/config.py:735 | hostedContents capture concurrency (backup). |
| `CHAT_HOSTED_CONTENT_MAX_BYTES` | `25_000_000` | int | shared/config.py:738 | Max single hostedContent payload size. |

### OneDrive backup
| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `ONEDRIVE_BACKUP_V2_ENABLED` | `true` | bool | shared/config.py:373 | New uncapped, resumable OneDrive pipeline. |
| `ONEDRIVE_BACKUP_FILE_CONCURRENCY` | `16` | int | shared/config.py:374 | Concurrent file fetches per drive. (Deployed: 128 on heavy worker.) |
| `ONEDRIVE_PREFETCH_CONCURRENCY` | `16` | int | workers/backup-worker/main.py | Files prefetched (downloaded) ahead of upload. (Deployed: 96 on heavy worker.) |
| `ONEDRIVE_HUGE_FILE_RAM_BUDGET_GIB` | `4` | int | workers/backup-worker/main.py:13720 | Worker-wide RAM budget for in-flight huge-file segments; bounds `min(file_concurrency, budget ÷ (segment_concurrency × segment_size))` concurrent huge files ⇒ download backpressures on the write. (Deployed: 16.) |
| `MAX_CONCURRENT_ONEDRIVE_BACKUPS_PER_WORKER` | `4` | int | shared/config.py:375 | Per-replica concurrent drives in flight. |
| `ONEDRIVE_BACKUP_FILE_TIMEOUT_SECONDS` | `21600` (6h) | int | shared/config.py:376 | Per-file timeout. |
| `ONEDRIVE_BACKUP_CHECKPOINT_EVERY_FILES` | `500` | int | shared/config.py:377 | Checkpoint after N files. |
| `ONEDRIVE_BACKUP_CHECKPOINT_EVERY_BYTES` | `1 GiB` | int | shared/config.py:378 | Checkpoint after N bytes. |
| `ONEDRIVE_LARGE_FILE_THRESHOLD_BYTES` | `256 MiB` | int | shared/config.py:383 | Files larger use parallel Range-GET. |
| `ONEDRIVE_LARGE_FILE_SEGMENT_BYTES` | `64 MiB` | int | shared/config.py:387 | Range segment size for huge-file fetch. |
| `ONEDRIVE_LARGE_FILE_SEGMENT_CONCURRENCY` | `8` | int | shared/config.py:397 | Concurrent Range fetches per huge file. |
| `ONEDRIVE_FLUSH_INTERVAL_S` | `30` | int | workers/backup-worker/main.py:12931 | snapshot_items flush cadence. |
| `ONEDRIVE_STREAM_MAX_RESUMES` | `4` | int | workers/backup-worker/main.py:14990 | Stream resume budget per file. |
| `ONEDRIVE_RETRY_QUEUE_ENABLED` | `true` | bool | workers/backup-worker/main.py:13320 | Enable per-file retry queue. |
| `ONEDRIVE_RETRY_BATCH_SIZE` | `20` | int | workers/backup-worker/main.py:13400 | Retry queue dequeue batch. |
| `ONEDRIVE_RETRY_MAX_ATTEMPTS` | `8` | int | workers/backup-worker/main.py:13401 | Retry attempts before giving up on file. |
| `ONEDRIVE_RETRY_POLL_INTERVAL_S` | `60` | int | workers/backup-worker/main.py:13398 | Retry-queue poll cadence. |
| `ONEDRIVE_RETRY_STALL_MINUTES` | `5` | int | workers/backup-worker/main.py:13450 | Mark retry stalled after N min idle. |
| `ONEDRIVE_RETRY_CONCURRENCY` | `8` | int | workers/backup-worker/main.py:13509 | Concurrent retry workers. |
| `ONEDRIVE_RETRY_HEARTBEAT_S` | `60` | int | workers/backup-worker/main.py:13648 | Heartbeat cadence on retry worker. |

### Partition lanes (OneDrive / Chats / Mail / SharePoint / Groups / Entra)
| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `ONEDRIVE_PARTITION_ENABLED` | `true` | bool | shared/config.py:413 | Split big drives across replicas. |
| `ONEDRIVE_PARTITION_MIN_BYTES` | `5 GiB` | int | shared/config.py:416 | Min drive bytes to trigger partition. |
| `ONEDRIVE_PARTITION_MIN_FILES` | `200` | int | shared/config.py:419 | Min file count to trigger partition. |
| `ONEDRIVE_PARTITION_MAX_SHARDS` | `4` | int | shared/config.py:422 | Max shards per drive. |
| `ONEDRIVE_PARTITION_TARGET_BYTES_PER_SHARD` | `20 GiB` | int | shared/config.py:425 | Target bytes per shard. |
| `ONEDRIVE_PARTITION_STALE_SWEEP_MIN` | `30` | int | shared/config.py:432 | Per-shard timeout (min) before stale-sweep retry. |
| `CHATS_PARTITION_ENABLED` | `true` | bool | shared/config.py:444 | Split whale chat users across replicas. |
| `CHATS_PARTITION_MIN_CHATS` | `25` | int | shared/config.py:454 | Min chats to partition. |
| `CHATS_PARTITION_TARGET_CHATS_PER_SHARD` | `50` | int | shared/config.py:457 | Target chats per shard. |
| `CHATS_PARTITION_MAX_SHARDS` | `6` | int | shared/config.py:464 | Max shards per user. |
| `MAIL_PARTITION_ENABLED` | `true` | bool | shared/config.py:471 | Mail partition lane. |
| `MAIL_PARTITION_MIN_FOLDERS` | `20` | int | shared/config.py:477 | Min folders to partition. |
| `MAIL_PARTITION_MIN_BYTES` | `2 GiB` | int | shared/config.py:484 | Min mailbox bytes to partition. |
| `MAIL_PARTITION_MAX_SHARDS` | `4` | int | shared/config.py:487 | Max mail shards. |
| `MAIL_PARTITION_TARGET_BYTES_PER_SHARD` | `2 GiB` | int | shared/config.py:490 | Target bytes per mail shard. |
| `SP_PARTITION_ENABLED` | `true` | bool | shared/config.py:496 | SharePoint partition lane. |
| `SP_PARTITION_MIN_DRIVES` | `3` | int | shared/config.py:499 | Min drives for SP partition. |
| `SP_PARTITION_MIN_BYTES` | `5 GiB` | int | shared/config.py:502 | Min site bytes. |
| `SP_PARTITION_MAX_SHARDS` | `4` | int | shared/config.py:505 | Max SP shards. |
| `SP_PARTITION_TARGET_BYTES_PER_SHARD` | `20 GiB` | int | shared/config.py:508 | Target SP shard size. |
| `GROUPS_PARTITION_ENABLED` | `true` | bool | shared/config.py:519 | Groups/Teams partition lane. |
| `GROUPS_PARTITION_MIN_CHANNELS` | `8` | int | shared/config.py:522 | Min channels to partition. |
| `GROUPS_PARTITION_MAX_SHARDS` | `4` | int | shared/config.py:525 | Max groups shards. |
| `GROUPS_PARTITION_CHANNELS_PER_SHARD` | `4` | int | shared/config.py:528 | Channels per shard. |
| `ENTRA_PARTITION_ENABLED` | `true` | bool | shared/config.py:541 | Entra-directory partition lane. |
| `ENTRA_PARTITION_MIN_CATEGORIES` | `4` | int | shared/config.py:544 | Min Entra categories to trigger partition. |
| `ENTRA_PARTITION_MAX_SHARDS` | `4` | int | shared/config.py:547 | Max Entra shards. |
| `ENTRA_PARTITION_CATEGORIES_PER_SHARD` | `2` | int | shared/config.py:550 | Categories per Entra shard. |
| `MAX_CONCURRENT_PARTITIONS_PER_TENANT` | `2` | int | shared/config.py:559 | Per-tenant concurrent partition shards cap. |
| `PARTITION_MAX_RETRIES` | `5` | int | shared/config.py:566 | Per-partition retry budget. |

### Reconciler / lease / heartbeat / scheduler
| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `RECONCILER_BATCH` | `200` | int | shared/reconciler.py:25 | Rows per reconciler sweep. |
| `RECONCILER_MAX_REQUEUE` | `3` | int | shared/reconciler.py:26 | Max requeues per orphan. |
| `RECONCILER_PART_STALE_MIN` | `15` | int | shared/reconciler.py:40 | Partition stall threshold (min). |
| `RECONCILER_SNAP_LEGACY_AGE_S` | `900` | int | shared/reconciler.py:47 | Snapshot considered legacy after N s. |
| `RECONCILER_JOB_LEGACY_AGE_S` | `900` | int | shared/reconciler.py:46 | Job legacy threshold. |
| `RECONCILER_DRY_RUN` | `false` | bool | shared/reconciler.py:48 | Dry-run reconciler (no mutations). |
| `HEARTBEAT_INTERVAL_S` | `10` | int | shared/heartbeat.py:28 | Worker heartbeat write cadence. |
| `HEARTBEAT_STALE_S` | `60` | int | shared/reconciler.py:27 | Heartbeat considered stale after N s. |
| `LEASE_TTL_S` | `600` | int | shared/lease.py:32 | Distributed lease TTL. |
| `LEASE_RENEW_S` | `120` | int | shared/lease.py:33 | Lease renew cadence. |
| `LIFECYCLE_PARALLELISM` | `20` | int | services/backup-scheduler/main.py:2814 | Lifecycle sweep parallelism. |
| `LIFECYCLE_TENANT_TIMEOUT_S` | `600` | float | services/backup-scheduler/main.py:2820 | Per-tenant lifecycle timeout. |
| `LIFECYCLE_WORKLOAD_PARALLELISM` | `4` | int | services/backup-scheduler/main.py:2825 | Lifecycle workloads in parallel. |
| `LIFECYCLE_SWEEP_ATTEMPT_CAP` | `25` | int | services/backup-scheduler/main.py:3113 | Per-row attempt cap. |
| `LIFECYCLE_SWEEP_PARALLELISM` | `10` | int | services/backup-scheduler/main.py:3114 | Sweep parallelism. |
| `LIFECYCLE_SWEEP_TIMEOUT_S` | `60` | float | services/backup-scheduler/main.py:3115 | Sweep step timeout. |
| `ORPHAN_SWEEP_INTERVAL_S` | `60` | int | services/backup-scheduler/main.py:2361 | Orphan-sweep cadence. |
| `BACKUP_VERIFY_SAMPLE_SIZE` | `50` | int | services/backup-scheduler/main.py:2434 | Random sample size for verification. |
| `BACKUP_VERIFY_LOOKBACK_HOURS` | `24` | int | services/backup-scheduler/main.py:2435 | Verification lookback window. |
| `TIER2_DISCOVERY_BACKSTOP_S` | `7*3600` (7h) | int | services/backup-scheduler/main.py:1266 | Tier-2 discovery backstop interval. |
| `TIER2_DISCOVERY_MESSAGE_CHUNK_SIZE` | `25` | int | shared/config.py | Users per `discovery.tier2` queue message; 4k users produce about 160 chunks for replica fan-out. |
| `TIER2_DISCOVERY_USER_CONCURRENCY` | `4` | int | shared/config.py | Concurrent users per discovery-worker chunk; each user probes five workload types in parallel. |
| `SCHEDULER_RESCHEDULE_INTERVAL_SECONDS` | `300` | int | shared/config.py | Backup-scheduler interval for rebuilding in-memory SLA cron jobs from the DB. |
| `SCHEDULER_CATCHUP_INTERVAL_SECONDS` | `300` | int | shared/config.py | Backup-scheduler interval for scanning and dispatching missed SLA fires after downtime. |
| `SCHEDULER_CATCHUP_LOOKBACK_MINUTES` | `1440` | int | shared/config.py | Missed scheduled-run lookback window. Default is 24 hours. |
| `SCHEDULER_MISFIRE_GRACE_SECONDS` | `21600` | int | shared/config.py | APScheduler in-process misfire grace window. Default is 6 hours. |
| `BATCH_STALL_TIMEOUT_HOURS` | `24` | int | shared/config.py:273 | Watchdog: stalled batch finalize timeout. |
| `DISCOVERY_DEADLINE_MIN` | `60` | int | shared/config.py:282 | batch_pending_users watchdog deadline. |
| `WORKER_REGION` | `default` | str | shared/models.py:668 (comment) | Region tag on partition claims. |

### Anomaly detection
| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `ANOMALY_MIN_PRIOR_SNAPSHOTS` | `3` | int | workers/backup-worker/main.py:21085 | Min priors needed before flagging. |
| `ANOMALY_MIN_AVG_ITEMS` | `20` | int | workers/backup-worker/main.py:21086 | Ignore resources with avg<N items. |
| `ANOMALY_MIN_DELETED_ITEMS` | `50` | int | workers/backup-worker/main.py:21093 | Min deleted items to consider anomaly. |
| `ANOMALY_DELETION_FRACTION` | `0.30` | float | workers/backup-worker/main.py:21094 | Fraction-deleted threshold. |
| `ANOMALY_DROP_RATIO` | `0.5` | float | workers/backup-worker/main.py:21096 | Drop-ratio threshold. |

### Multi-app & routing
| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `HOSTNAME` | `""` | str | shared/multi_app_manager.py:171 | Process hostname (replica id fallback). |
| `REPLICA_ID` | `""` | str | shared/multi_app_manager.py:172 | Per-process replica id (preferred when set; used for per-replica state isolation). |
| `RAILWAY_GIT_COMMIT_SHA` | — | str | shared/heartbeat.py:70 | Heartbeat-emitted code version. |
| `RAILWAY_SERVICE_NAME` | `backup_worker` | str | workers/backup-worker/main.py:2008 | Service tag in metrics/logs. |
| `RAILWAY_SERVICE_API_GATEWAY_URL` | required | str | workers/chat-export-worker/consumers/thread.py:273 | Internal-network API gateway URL. |
| `API_GATEWAY_PUBLIC_URL` | — | str | workers/chat-export-worker/consumers/thread.py:271 | Public-facing gateway URL (for signed-URL replies). |
| `ROUTING_FENCE_ENABLED` | `true` | bool | shared/routing_fence.py:26 | Block infinite ping-pong between services. |
| `ROUTING_MAX_HOPS` | `2` | int | shared/routing_fence.py:27 | Max inter-service hops per request. |

### Autoscaler
| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `AUTOSCALER_CONFIG` | required | str | services/autoscaler/main.py:102 | JSON blob defining scaling rules. |
| `SCALE_INTERVAL_S` | `60` | float | services/autoscaler/main.py:251 | Scale-check cadence. |
| `SCALE_HYSTERESIS` | `1` | int | services/autoscaler/main.py:252 | Stable cycles required before scale action. |

---

## 8. Export pipelines (Mail / OneDrive / Chat / Entra)

### Mail export
| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `EXPORT_PARALLELISM` | `12` | int | shared/config.py:243 | Workers per export pipeline. |
| `EXPORT_MBOX_SPLIT_BYTES` | `5 GiB` | int | shared/config.py:244 | Split MBOX file at N bytes. |
| `EXPORT_BLOCK_SIZE_BYTES` | `4 MiB` | int | shared/config.py:245 | Stream block size. |
| `EXPORT_FOLDER_QUEUE_MAXSIZE` | `20` | int | shared/config.py:246 | Bounded queue for folder fan-out. |
| `MAX_CONCURRENT_EXPORTS_PER_WORKER` | `2` | int | shared/config.py:247 | Concurrent exports per worker. |
| `EXPORT_FETCH_BATCH_SIZE` | `50` | int | shared/config.py:347 | Items fetched per Graph call. |
| `EXPORT_MEMORY_SOFT_LIMIT_PCT` | `80` | int | shared/config.py:348 | RSS soft cap (% RAM). |
| `EXPORT_MEMORY_KILL_GRACE_SECONDS` | `60` | int | shared/config.py:349 | Grace after exceeding RSS cap. |
| `EXPORT_MAIL_V2_ENABLED` | `true` | bool | shared/config.py:353 | v2 streaming mail export pipeline. |
| `EXPORT_MBOX_INLINE_LIMIT_BYTES` | `100 MiB` | int | shared/config.py:358 | MBOX inline-vs-intermediate threshold. |

### OneDrive export
| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `EXPORT_ONEDRIVE_V2_ENABLED` | `true` | bool | shared/config.py:363 | v2 OneDrive export. |
| `EXPORT_ONEDRIVE_MISSING_POLICY` | `skip` | str | shared/config.py:364 | Policy when source file missing (skip/fail). |
| `EXPORT_ONEDRIVE_INCLUDE_VERSIONS` | `false` | bool | shared/config.py:365 | Include historical versions in ZIP. |
| `EXPORT_ONEDRIVE_MAX_FILE_BYTES` | `200 GiB` | int | shared/config.py:366 | Per-file size cap. |
| `EXPORT_ONEDRIVE_PATH_MAX_LEN` | `260` | int | shared/config.py:367 | Max path length (Windows-safe). |
| `EXPORT_ONEDRIVE_SANITIZE_CHARS` | `<>:"/\\|?*` | str | shared/config.py:368 | Chars sanitized from path. |
| `FILES_FOLDER_SELECT_V2` | `true` | bool | shared/config.py:337 | folderPaths/excludedItemIds payload + UI. |

### Chat export
| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `CHAT_EXPORT_DEFAULT_ENABLED` | `true` | bool | shared/config.py:259 | Default tenant chat-export gate. |
| `CHAT_EXPORT_TENANT_CONCURRENT_MIN` | `200` | int | shared/config.py:695 | Min concurrent chat-export tasks per tenant. |
| `CHAT_EXPORT_TENANT_CONCURRENT_PER_USER` | `0.5` | float | shared/config.py:698 | Per-user concurrency multiplier. |
| `CHAT_EXPORT_BLOB_ACCOUNT_SHARDS` | `4` | int | shared/config.py:701 | Number of blob-account shards. |
| `CHAT_EXPORT_BLOB_ACCOUNTS` | `"" → stexport1..4` | list[str] | shared/config.py:703 | Comma-sep blob accounts (defaults stexport1..stexport4). |
| `CHAT_EXPORT_PROGRESS_TRANSPORT` | `sse` | str | shared/config.py:710 | Progress channel: `sse` or `poll`. |
| `CHAT_EXPORT_SIZE_SOFT_CAP_BYTES` | `21_474_836_480` (20 GB) | int | shared/config.py:715 | Soft cap on export size. |
| `CHAT_EXPORT_SIZE_HARD_CAP_BYTES` | `1_099_511_627_776` (1 TiB) | int | shared/config.py:719 | Hard cap. |
| `CHAT_EXPORT_BLOB_TTL_HOURS` | `168` (7d) | int | shared/config.py:722 | Lifetime of exported blob. |
| `CHAT_EXPORT_SAS_TTL_HOURS` | `168` | int | shared/config.py:725 | SAS URL TTL. |
| `CHAT_EXPORT_HOT_TIER_HOURS` | `24` | int | shared/config.py:728 | Hot-tier retention before cool. |
| `CHAT_EXPORT_DYNAMIC_PREFETCH` | `true` | bool | shared/config.py:731 | Adaptive prefetch on chat-export queue. |

### Entra export
| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `ENTRA_EXPORT_V2_ENABLED` | `true` | bool | shared/config.py:332 | Server-side Entra ZIP export. |

---

## 9. Restore pipelines (Mail / Contacts / OneDrive / Entra / PST)

### Mail restore
| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `MAIL_RESTORE_V2_ENABLED` | `true` | bool | shared/config.py:263 | AFI-parity mail restore. |
| `MAIL_RESTORE_GLOBAL_POOL` | `32` | int | shared/config.py:287 | Per-worker global mail-restore cap. |
| `MAIL_RESTORE_PER_MAILBOX` | `4` | int | shared/config.py:291 | Per-target-mailbox concurrency cap. |
| `MAIL_RESTORE_MAX_RETRIES` | `5` | int | shared/config.py:293 | Per-item retry budget. |
| `MAIL_RESTORE_ATTACH_LARGE_MB` | `3` | int | shared/config.py:296 | Threshold for uploadSession path. |

### Contact restore
| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `CONTACT_RESTORE_ENGINE_ENABLED` | `true` | bool | shared/config.py:303 | New batched contact-restore engine. |
| `CONTACT_RESTORE_GLOBAL_POOL` | `32` | int | shared/config.py:304 | Worker-global cap. |
| `CONTACT_RESTORE_PER_USER` | `4` | int | shared/config.py:307 | Per-user concurrency cap. |
| `CONTACT_RESTORE_MAX_RETRIES` | `5` | int | shared/config.py:308 | Retry budget. |

### OneDrive restore
| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `ONEDRIVE_RESTORE_ENGINE_ENABLED` | `true` | bool | shared/config.py:313 | New OneDrive-restore engine. |
| `ONEDRIVE_RESTORE_CONCURRENCY` | `16` | int | shared/config.py:314 | Concurrent file restores. |
| `ONEDRIVE_RESTORE_CHUNK_BYTES` | `10 MiB` | int | shared/config.py:315 | uploadSession chunk size. |
| `ONEDRIVE_RESTORE_PER_TARGET_USER_CAP` | `5` | int | shared/config.py:316 | Per-target-user cap. |
| `ONEDRIVE_RESTORE_STREAMING_THRESHOLD_BYTES` | `64 MiB` | int | shared/config.py:322 | Threshold to switch to streaming path. |

### Entra restore
| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `ENTRA_RESTORE_V2_ENABLED` | `true` | bool | shared/config.py:330 | New Entra restore engine. |
| `ENTRA_RESTORE_GLOBAL_POOL` | `32` | int | shared/config.py:340 | Worker-global cap. |
| `ENTRA_RESTORE_PER_TENANT` | `4` | int | shared/config.py:344 | Per-tenant $batch concurrency. |
| `ENTRA_RESTORE_MAX_RETRIES` | `5` | int | shared/config.py:346 | Retry budget. |

### PST export
| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `PST_WRITE_CONCURRENCY` | `1` | int | workers/restore-worker/pst_export.py:37 | Concurrent PST writer processes. |
| `PST_DISK_OVERHEAD_MULTIPLIER` | `2.0` | float | workers/restore-worker/pst_export.py:39 | Disk-headroom multiplier for PST generation. |
| `PST_DISK_FLOOR_BYTES` | `256 MiB` | int | workers/restore-worker/pst_export.py:40 | Minimum disk reserve. |
| `PST_MEMORY_LIMIT_MB` | `0` | int | workers/restore-worker/pst_export.py:41 | Per-task RSS cap (0=off). |
| `PST_MEMORY_CHECK_INTERVAL` | `50` | int | workers/restore-worker/pst_export.py:42 | RSS check cadence (items). |
| `PST_GROUP_TIMEOUT_S` | `7200` | int | workers/restore-worker/pst_export.py:43 | Per-group PST timeout. |
| `PST_TENANT_CONCURRENCY` | `3` | int | workers/restore-worker/pst_export.py:51 | Per-tenant PST tasks. |
| `PST_RATE_LIMIT_PER_KEY` | falls back to PST_TENANT_CONCURRENCY (`3`) | int | workers/restore-worker/pst_export.py:50 | Per-rate-limit-key PST concurrency cap (override above when set; "disabled" to turn off). |
| `PST_RATE_LIMIT_SCOPE` | `user` | str | workers/restore-worker/pst_export.py:53 | Rate-limit scope (user/tenant). |
| `PST_CANCEL_CHECK_INTERVAL` | `10` | int | workers/restore-worker/pst_export.py:54 | Cancel poll cadence (items). |
| `PST_AUTO_FOLDER_THRESHOLD` | `5000` | int | workers/restore-worker/pst_export.py:411 | Auto-split big folders past N items. |
| `PST_GROUP_FLUSH_AT` | `1000` | int | workers/restore-worker/pst_export.py:529 | Flush PST writer buffer at N items. |
| `PST_TOTAL_ACCUMULATED_CAP` | `5000` | int | workers/restore-worker/pst_export.py:530 | Total accumulated items cap. |
| `PST_ZIP_BLOCK_SIZE` | `4 MiB` | int | workers/restore-worker/pst_export.py:920 | ZIP block size. |
| `PST_MAX_BLOCKS_PER_CHUNK` | `0` | int | workers/restore-worker/pst_writers/base.py:300 | Override blocks-per-chunk (0=auto). |
| `PST_FETCH_BATCH_SIZE` | `1000` | int | workers/restore-worker/main.py:1891 | Items per fetch when building PST. |
| `PST_MAX_ATTACHMENT_BYTES` | `50 MiB` | int | workers/restore-worker/mail_fetch.py:218 | Skip attachments above this size. |
| `PSTWRITER_CLI` | `""` | str | shared/pstwriter_cli.py:58 | Path override for the PST writer CLI binary. |
| `PSTWRITER_CLI_TIMEOUT_S` | `3600` | int | shared/pstwriter_cli.py:51 | PST writer subprocess timeout. |
| `PST_METRICS_PORT` | `9100` | int | shared/pst_metrics.py:109 | Prometheus port for PST metrics. |

### Backup contacts
| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `BACKUP_CONTACTS_INCLUDE_DELETED` | `true` | bool | shared/config.py:584 | Capture IPM.Contact in Deleted Items. |
| `BACKUP_CONTACTS_INCLUDE_RECOVERABLE` | `true` | bool | shared/config.py:587 | Capture IPM.Contact in Recoverable Items. |

---

## 10. Feature flags & versioning

| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `BATCH_ROW_REDESIGN_ENABLED` | `false` | bool | shared/config.py:270 | First-class backup_batches row per click. |
| `AUDIT_EMIT_PARTITION_EVENTS` | `false` | bool | workers/backup-worker/main.py:2712 | Emit partition events to audit. |
| `MAX_FILE_VERSIONS` | `0` | int | workers/backup-worker/main.py:14402 | Cap on file versions kept (0=unlimited). |
| `VERSION_CARRY_FORWARD_ENABLED` | `true` | bool | workers/backup-worker/main.py:14475 | Carry forward unchanged versions between snapshots. |
| `VERSION_DB_FLUSH_FILES` | `100` | int | workers/backup-worker/main.py:14469 | DB flush every N versioned files. |
| `VERSION_DB_FLUSH_SECONDS` | `5` | int | workers/backup-worker/main.py:14470 | DB flush every N seconds. |
| `VERSION_GLOBAL_PARALLEL` | `32` | int | workers/backup-worker/main.py:14464 | Concurrent version fetches. |
| `VERSION_GRAPH_BATCH_SIZE` | `20` (max 20) | int | workers/backup-worker/main.py:14466 | Versions per $batch call. |
| `VERSION_INLINE_BUFFER_MB` | `32` | int | workers/backup-worker/main.py:14452 | Inline buffer per version. |
| `VERSION_STREAM_CHUNK_MB` | `16` | int | workers/backup-worker/main.py:14459 | Streaming chunk size for version blob. |
| `VERSION_STREAM_DISK_THRESHOLD_MB` | `256` | int | workers/backup-worker/main.py:14456 | Switch to disk-spool above N MB. |
| `VERSION_LIST_BATCH_WAIT_MS` | `200` | int | workers/backup-worker/main.py:14529 | Batch-wait window for version listing. |
| `VERSIONABLE_EXTS` | `_DEFAULT_VERSIONABLE_EXTS` (csv) | list[str] | workers/backup-worker/main.py:14420 | File extensions eligible for versioning. |
| `BLOB_DEDUP_MIN_SIZE_BYTES` | `1024` | int | workers/backup-worker/main.py:7978 | Skip dedup for tiny blobs. |
| `BLOB_DEDUP_BULK_CHUNK` | `500` | int | shared/blob_dedup.py:56 | Bulk-lookup chunk size. |
| `BLOB_DEDUP_LRU_MAX_ENTRIES` | `10000` | int | shared/blob_dedup.py:63 | In-process LRU size. |
| `BLOB_DEDUP_LRU_HIT_TTL_S` | `300` | int | shared/blob_dedup.py:64 | LRU positive TTL. |
| `BLOB_DEDUP_LRU_MISS_TTL_S` | `30` | int | shared/blob_dedup.py:65 | LRU negative TTL. |

---

## 11. Auth, cookies, CORS, frontend URL

| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `JWT_SECRET` | `""` | str | shared/config.py:60 | HS256 JWT signing secret (legacy single-secret). |
| `JWT_ALGORITHM` | `HS256` (constant) | str | shared/config.py:61 | Algorithm (hardcoded). |
| `JWT_EXPIRATION_HOURS` | `1` | int | shared/config.py:67 | Access-token TTL (hours). |
| `JWT_REFRESH_EXPIRATION_DAYS` | `7` | int | shared/config.py:68 | Refresh-token TTL (days). |
| `ACCESS_TOKEN_SECRET` | `""` → JWT_SECRET | str | shared/config.py:72 | Per-class access secret (token-swap defense). |
| `REFRESH_TOKEN_SECRET` | `""` → JWT_SECRET | str | shared/config.py:73 | Per-class refresh secret. |
| `INTERNAL_API_KEY` | `""` | str | shared/config.py:78 | Internal service-to-service shared key. Empty → service fails closed. |
| `COOKIE_SECURE` | auto (https→true) | bool | shared/config.py:85 | Force/disable Secure flag on auth cookies. |
| `COOKIE_SAMESITE` | `strict` | str | shared/config.py:96 | SameSite policy (strict/lax/none). |
| `COOKIE_DOMAIN` | `""` (None) | str | shared/config.py:99 | Override cookie domain. |
| `FRONTEND_URL` | `http://localhost:4200` | str | shared/config.py:748 | SPA URL (used for OAuth redirects, cookie-secure decisions). |
| `CORS_ORIGINS` | (see below) | str | shared/config.py:744 | Preferred CORS origin list (csv). |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:4200,http://localhost:3000,http://localhost:5173` | str | shared/config.py:744 | Fallback CORS origins (csv). |
| `ENCRYPTION_KEY` | `""` | str | shared/config.py:233 | Fernet key (base64 32-byte) for column encryption. |
| `TOGGLE_CONFIRM_TEXT` | — (None) | str | api-gateway/routes/admin_storage.py:331 | Required confirm text for storage-toggle ops. |

---

## 12. Microservice URLs

| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `AUTH_SERVICE_URL` | `http://auth-service:8001` | str | shared/config.py:771 | auth-service base URL. |
| `TENANT_SERVICE_URL` | `http://tenant-service:8002` | str | shared/config.py:772 | tenant-service URL. |
| `RESOURCE_SERVICE_URL` | `http://resource-service:8003` | str | shared/config.py:773 | resource-service URL. |
| `JOB_SERVICE_URL` | `http://job-service:8004` | str | shared/config.py:774 | job-service URL. |
| `SNAPSHOT_SERVICE_URL` | `http://snapshot-service:8005` | str | shared/config.py:775 | snapshot-service URL. |
| `DASHBOARD_SERVICE_URL` | `http://dashboard-service:8006` | str | shared/config.py:776 | dashboard-service URL. |
| `ALERT_SERVICE_URL` | `http://alert-service:8007` | str | shared/config.py:777 | alert-service URL. |
| `BACKUP_SCHEDULER_URL` | `http://backup-scheduler:8008` | str | shared/config.py:778 | backup-scheduler URL. |
| `GRAPH_PROXY_URL` | `http://graph-proxy:8009` | str | shared/config.py:779 | graph-proxy URL. |
| `DELTA_TOKEN_URL` | `http://delta-token:8010` | str | shared/config.py:780 | delta-token URL. |
| `PROGRESS_TRACKER_URL` | `http://progress-tracker:8011` | str | shared/config.py:781 | progress-tracker URL. |
| `AUDIT_SERVICE_URL` | `http://audit-service:8012` / `…:8080` | str | shared/config.py:782, shared/audit.py:41 | audit-service URL. |
| `REPORT_SERVICE_URL` | `http://report-service:8014` | str | shared/config.py:783 | report-service URL. |
| `ELASTICSEARCH_URL` | `http://localhost:9200` | str | shared/config.py:742 | Elasticsearch base (disabled by default). |
| `AUDIT_POST_TIMEOUT_S` | `5.0` | float | shared/audit.py:34 | Timeout on audit-service POST. |
| `ACTIVITY_GROUP_DEFAULT` | `batch` | str | services/audit-service/main.py:1051 | Default group label for activities. |
| `ARCHIVED_PURGE_GRACE_DAYS` | `30` | int | services/audit-service/main.py:498 | Grace before archived row purge. |
| `ARCHIVED_PURGE_INTERVAL_S` | `3600` | int | services/audit-service/main.py:499 | Cadence of archived-row purge sweep. |
| `CHAT_INTEGRITY_INTERVAL_S` | `24*3600` | int | services/audit-service/main.py:351 | Chat-integrity sweep cadence. |
| `CHAT_INTEGRITY_TOLERANCE_PCT` | `1.0` | float | services/audit-service/main.py:354 | Tolerance for chat integrity mismatch. |

---

## 13. Notifications / SMTP

| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `NOTIFICATION_EMAIL_ENABLED` | `false` | bool | services/report-service/main.py:43 | Enable SMTP-based notifications. |
| `NOTIFICATION_EMAIL_SMTP_HOST` | `smtp.office365.com` | str | services/report-service/main.py:44 | SMTP host. |
| `NOTIFICATION_EMAIL_SMTP_PORT` | `587` | int | services/report-service/main.py:45 | SMTP port. |
| `NOTIFICATION_EMAIL_SMTP_USERNAME` | `""` | str | services/report-service/main.py:46 | SMTP username. |
| `NOTIFICATION_EMAIL_SMTP_PASSWORD` | `""` | str | services/report-service/main.py:47 | SMTP password. |
| `NOTIFICATION_EMAIL_FROM` | `noreply@tm-vault.io` | str | services/report-service/main.py:48 | From address. |

---

## 14. Storage-toggle worker (DR / failover orchestration)

| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `DNS_FLIP_STRATEGY` | `noop` | str | services/storage_toggle_worker/dns_flip.py:10 | DNS strategy (noop / script). |
| `DNS_FLIP_SCRIPT` | `/opt/tmvault/ops/dns/flip.sh` | str | services/storage_toggle_worker/dns_flip.py:15 | External flip script path. |
| `PG_PROMOTE_STRATEGY` | `noop` | str | services/storage_toggle_worker/pg_promote.py:21 | Postgres promote strategy. |
| `PATRONI_TARGET_URL` | — | str | services/storage_toggle_worker/pg_promote.py:26 | Patroni API URL when used. |
| `WORKER_RESTART_STRATEGY` | `noop` | str | services/storage_toggle_worker/worker_restart.py:16 | Worker restart strategy. |
| `TOGGLE_SMOKE_PASSTHROUGH_REQUIRED` | `0` | bool ("1") | services/storage_toggle_worker/smoke.py:45 | Require successful passthrough on smoke. |
| `TOGGLE_SMOKE_PASSTHROUGH_TIMEOUT_S` | `15` | int | services/storage_toggle_worker/smoke.py:46 | Passthrough smoke timeout. |

---

## 15. Observability — metrics ports

| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `CORE_METRICS_PORT` | `9103` | int | shared/core_metrics.py:234 | Core (per-service) Prometheus port. |
| `SLA_METRICS_PORT` | `9101` | int | shared/sla_metrics.py:115 | SLA metrics Prometheus port. |
| `PST_METRICS_PORT` | `9100` | int | shared/pst_metrics.py:109 | PST metrics port (see §9). |

---

## 16. Frontend (Vite + Playwright)

| Env Var | Default | Type | Where Used | Description |
|---|---|---|---|---|
| `VITE_API_URL` | `http://localhost:8080/api/v1` | str | tm_vault/src/config/api.ts:6 | Backend API base URL the SPA targets. |
| `E2E_URL` | `http://localhost:5173` | str | tm_vault/e2e/chat-export.spec.ts:4 | Playwright base URL for e2e tests. |
| `E2E_USER` | required | str | tm_vault/e2e/chat-export.spec.ts:5 | Login user for e2e. |
| `E2E_PASS` | required | str | tm_vault/e2e/chat-export.spec.ts:6 | Login password for e2e. |

---

## Computed / derived (not direct env vars)

These are exposed as `settings.*` properties built from the above:

- `RABBITMQ_URL` (property) — derived from RABBITMQ_USER/PASSWORD/HOST/PORT; raises if guest:guest or empty (shared/config.py:903).
- `DATABASE_URL` (property) — derived from DB_HOST/PORT/NAME/USERNAME/PASSWORD, URL-encoded (shared/config.py:894).
- `REDIS_URL_FULL` — derived URL safe for `Redis.from_url(...)` (shared/config.py:139).
- `MICROSOFT_CLIENT_ID/SECRET/TENANT_ID` — first GRAPH_APPS entry (shared/config.py:857-866).
- `EFFECTIVE_POWER_BI_CLIENT_ID/SECRET/TENANT_ID` — falls back to Microsoft primary app when POWER_BI_* unset (shared/config.py:869-878).
- `EFFECTIVE_ARM_CLIENT_ID/SECRET/TENANT_ID` — falls back to Microsoft primary app when AZURE_ARM_* unset (shared/config.py:882-891).
- `GRAPH_APP_COUNT` — len(GRAPH_APPS).
