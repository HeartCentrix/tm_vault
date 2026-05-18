# TMvault Data Model

Sources:
- `tm_backend/shared/models.py` (1406 lines)
- `tm_backend/shared/schemas.py` (757 lines)
- `tm_backend/alembic/versions/` (3 migrations)

Alembic migrations: **3** total. Most recent: `20260517_0003_chat_drain_completeness_baseline.py` — adds `chat_threads.last_drained_msg_count` for the drain-completeness gate. Earlier: `20260517_0002_partition_big_tables.py`, `20260517_0001_baseline.py`.

Helper: `utcnow()` returns naive UTC `datetime` (`datetime.now(timezone.utc).replace(tzinfo=None)`). Used as the default for nearly every timestamp.

---

# Enums

## UserRole `(str, Enum)`
| Value | Meaning |
|-------|---------|
| `SUPER_ADMIN` | Platform super-admin |
| `ORG_ADMIN` | Org-scoped admin |
| `TENANT_ADMIN` | Tenant-scoped admin |
| `BACKUP_OPERATOR` | Can trigger backups |
| `RESTORE_OPERATOR` | Can trigger restores |
| `CONTENT_VIEWER` | Read-only into backed-up content |
| `USER` | Regular user |

## TenantType `(str, Enum)`
| Value | Meaning |
|-------|---------|
| `M365` | Microsoft 365 workloads |
| `AZURE` | Azure subscription workloads |

Legacy `BOTH` removed. A tenant is exactly one workload type; create two tenant rows to back up M365 + Azure for the same Microsoft tenant.

## TenantStatus `(str, Enum)`
| Value | Meaning |
|-------|---------|
| `PENDING` | Newly created, awaiting setup |
| `ACTIVE` | Operational |
| `DISCONNECTED` | Lost credentials / Graph access |
| `SUSPENDED` | Admin-suspended |
| `PENDING_DELETION` | Soft-deleted, grace period |
| `DISCOVERING` | Discovery in flight |
| `PENDING_DISCOVERY` | Saved but discovery not yet enqueued |

## ResourceType `(str, Enum)`
Tier-1 (top-level) + Tier-2 (per-user content children, parented by `ENTRA_USER` via `parent_resource_id`).

| Value | Meaning |
|-------|---------|
| `MAILBOX` | User mailbox |
| `SHARED_MAILBOX` | Shared mailbox |
| `ROOM_MAILBOX` | Room/equipment mailbox |
| `ONEDRIVE` | User OneDrive |
| `SHAREPOINT_SITE` | SharePoint site |
| `TEAMS_CHANNEL` | Teams channel (UI-hidden; redundant w/ `M365_GROUP`) |
| `TEAMS_CHAT` | Teams chat |
| `TEAMS_CHAT_EXPORT` | Backup-scheduler-internal per-user chat delta shard (UI-hidden) |
| `ENTRA_DIRECTORY` | Per-tenant singleton "Azure AD" resource; AFI `office_directory` parity |
| `ENTRA_USER` | Entra user (Tier-1 parent for per-user content) |
| `ENTRA_GROUP` | Entra group |
| `M365_GROUP` | Unified modern group — links group mailbox + SP site + (optional) Team |
| `ENTRA_CONDITIONAL_ACCESS` | CA policy (full JSON: conditions + grants) |
| `ENTRA_BITLOCKER_KEY` | Per-device BitLocker recovery key metadata (no key bytes) |
| `ENTRA_APP` | App registration |
| `ENTRA_SERVICE_PRINCIPAL` | Service principal |
| `ENTRA_DEVICE` | Entra device |
| `ENTRA_ROLE` | Directory role |
| `ENTRA_ADMIN_UNIT` | Administrative unit |
| `ENTRA_AUDIT_LOG` | Audit log entry |
| `INTUNE_MANAGED_DEVICE` | Intune-managed device |
| `AZURE_VM` | Azure virtual machine |
| `AZURE_SQL_DB` | Azure SQL Database |
| `AZURE_POSTGRESQL` | Azure PostgreSQL Flexible Server |
| `AZURE_POSTGRESQL_SINGLE` | Azure PostgreSQL Single Server |
| `RESOURCE_GROUP` | Azure resource group |
| `DYNAMIC_GROUP` | Dynamic group container |
| `POWER_BI` | Power BI |
| `POWER_APPS` | Power Apps |
| `POWER_AUTOMATE` | Power Automate (Flow) |
| `POWER_DLP` | Power Platform DLP policy |
| `COPILOT` | Copilot |
| `PLANNER` | Microsoft Planner |
| `TODO` | Microsoft To Do |
| `ONENOTE` | OneNote |
| `USER_MAIL` | Tier-2 per-user mail (UI-hidden) |
| `USER_ONEDRIVE` | Tier-2 per-user OneDrive (UI-hidden) |
| `USER_CONTACTS` | Tier-2 per-user contacts (UI-hidden) |
| `USER_CALENDAR` | Tier-2 per-user calendar (UI-hidden) |
| `USER_CHATS` | Tier-2 per-user chats (UI-hidden) |

`UI_HIDDEN_TYPES` = `{TEAMS_CHAT_EXPORT, USER_MAIL, USER_ONEDRIVE, USER_CONTACTS, USER_CALENDAR, USER_CHATS, TEAMS_CHANNEL}`.

## ResourceStatus `(str, Enum)`
| Value | Meaning |
|-------|---------|
| `DISCOVERED` | Just discovered, not yet activated |
| `ACTIVE` | Active and backup-able |
| `ARCHIVED` | Archived (read-only) |
| `SUSPENDED` | Suspended from backup |
| `PENDING_DELETION` | Soft-deleted |
| `INACCESSIBLE` | Not found (404) or locked (423) in source system |

## JobType `(str, Enum)`
| Value | Meaning |
|-------|---------|
| `BACKUP` | Backup job |
| `RESTORE` | Restore job |
| `EXPORT` | Export (e.g., PST) job |
| `DISCOVERY` | Tenant/resource discovery |
| `DELETE` | Delete/purge job |

## JobStatus `(str, Enum)`
| Value | Meaning |
|-------|---------|
| `QUEUED` | Enqueued |
| `PENDING` | T0 migration: chat-export queued-but-idempotency-safe |
| `RUNNING` | Worker actively running |
| `COMPLETED` | Terminal success |
| `FAILED` | Terminal failure |
| `CANCELLED` | Terminal cancel |
| `CANCELLING` | T0 migration: transient while worker wraps up |
| `RETRYING` | Awaiting retry |

## SnapshotType `(str, Enum)`
| Value | Meaning |
|-------|---------|
| `FULL` | Full snapshot |
| `INCREMENTAL` | Incremental (delta) |
| `PREEMPTIVE` | Preemptive (scheduled ahead) |
| `MANUAL` | Operator-initiated |

## SnapshotStatus `(str, Enum)`
| Value | Meaning |
|-------|---------|
| `IN_PROGRESS` | Currently running |
| `COMPLETED` | Terminal success |
| `FAILED` | Terminal failure |
| `PARTIAL` | Terminal but with partial coverage |
| `PENDING_DELETION` | Soft-deleted, retention sweep will reap |

## StorageBackendKind `(str, Enum)`
| Value | Meaning |
|-------|---------|
| `azure_blob` | Azure Blob Storage backend |
| `seaweedfs` | SeaweedFS backend |

## TransitionState `(str, Enum)`
| Value | Meaning |
|-------|---------|
| `stable` | No active toggle |
| `draining` | Drain phase of backend swap |
| `flipping` | Final flip phase |

## ToggleStatus `(str, Enum)`
| Value | Meaning |
|-------|---------|
| `started` | Toggle initiated |
| `drain_started` | Drain phase began |
| `drain_completed` | Drain phase finished |
| `db_promoted` | Active backend promoted in DB |
| `dns_flipped` | DNS cutover done |
| `workers_restarted` | Workers cycled |
| `smoke_passed` | Smoke checks pass |
| `completed` | Toggle terminal success |
| `aborted` | Aborted mid-flight |
| `failed` | Terminal failure |

---

# Tables

## organizations
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| id | UUID | NO | `uuid.uuid4` | PK |
| name | String | NO | — | |
| slug | String | NO | — | UNIQUE |
| storage_region | String | YES | — | |
| encryption_mode | String | YES | `"TMVAULT_MANAGED"` | |
| storage_quota_bytes | BigInteger | YES | `500 * 1024**3` (500 GiB) | |
| storage_bytes_used | BigInteger | YES | `0` | |
| created_at | DateTime | YES | `utcnow` | |
| updated_at | DateTime | YES | `utcnow` (onupdate) | |

### Relationships
None declared on this class.

### Indexes
Implicit unique index on `slug`.

### Notes
Top-level tenancy container. Quotas + encryption-mode default to TMvault-managed.

---

## tenants
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| id | UUID | NO | `uuid.uuid4` | PK |
| org_id | UUID | NO | — | FK → organizations.id |
| type | Enum(TenantType) | YES | `M365` | |
| display_name | String | NO | — | |
| external_tenant_id | String | YES | — | UNIQUE, INDEX |
| customer_id | String | YES | — | |
| subscription_id | String | YES | — | |
| client_id | String | YES | — | |
| client_secret_ref | String | YES | — | |
| graph_client_id | String | YES | — | Graph API app-only credentials |
| graph_client_secret_encrypted | LargeBinary | YES | — | encrypted |
| status | Enum(TenantStatus) | YES | `PENDING` | |
| storage_region | String | YES | — | |
| last_discovery_at | DateTime | YES | — | |
| graph_delta_tokens | JSON (MutableDict) | YES | `{}` | |
| created_at | DateTime | YES | `utcnow` | |
| updated_at | DateTime | YES | `utcnow` (onupdate) | |
| dr_region_enabled | Boolean | NO | `False` | AZ-4 cross-region DR |
| dr_region | String | YES | — | e.g., "westeurope" |
| dr_storage_account_name | String | YES | — | |
| dr_storage_account_key_encrypted | LargeBinary | YES | — | |
| dr_last_replicated_at | DateTime | YES | — | |
| azure_refresh_token_encrypted | LargeBinary | YES | — | afi.ai-style Azure onboarding |
| azure_refresh_token_updated_at | DateTime(tz) | YES | — | |
| azure_subscriptions_cached | JSON | NO | `{}` | |
| azure_sql_servers_configured | JSON | NO | `{}` | |
| azure_pg_servers_configured | JSON | NO | `{}` | |
| extra_data | JSON (MutableDict) | YES | `{}` | |
| archived_at | DateTime(tz) | YES | — | P2 soft delete; 30-day grace before purge |

### Relationships
None declared (`Resource.tenant` is on the other side via `foreign_keys=[tenant_id]`, `lazy="raise"`).

### Indexes
Implicit on `external_tenant_id` (UNIQUE + INDEX).

### Notes
A Microsoft tenant onboarding row. Soft-deleted (`archived_at != NULL`) hides from reads; physical purge after 30-day grace by tenant-purge-worker.

---

## platform_users
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| id | UUID | NO | `uuid.uuid4` | PK |
| email | String | NO | — | UNIQUE, INDEX |
| name | String | NO | — | |
| external_user_id | String | YES | — | |
| org_id | UUID | YES | — | FK → organizations.id |
| tenant_id | UUID | YES | — | FK → tenants.id |
| mfa_enabled | Boolean | YES | `False` | |
| last_login_at | DateTime | YES | — | |
| created_at | DateTime | YES | `utcnow` | |
| updated_at | DateTime | YES | `utcnow` (onupdate) | |

### Notes
Platform user (operator). Distinct from `Resource(type=ENTRA_USER)` which represents an end-user discovered inside a customer tenant.

---

## user_roles
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| user_id | UUID | NO | — | PK, FK → platform_users.id |
| role | Enum(UserRole) | NO | — | PK |

### Notes
Many-to-many link from `platform_users` to `UserRole`. Composite PK = (user_id, role).

---

## resources
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| id | UUID | NO | `uuid.uuid4` | PK |
| tenant_id | UUID | NO | — | FK → tenants.id, INDEX |
| type | Enum(ResourceType) | NO | — | |
| external_id | String | NO | — | |
| display_name | String | NO | — | |
| email | String | YES | — | |
| extra_data (db: `metadata`) | JSON (MutableDict) | YES | `{}` | |
| resource_hash | String | YES | — | |
| sla_policy_id | UUID | YES | — | FK → sla_policies.id |
| status | Enum(ResourceStatus) | YES | `DISCOVERED` | |
| last_backup_job_id | UUID | YES | — | FK → jobs.id |
| last_backup_at | DateTime | YES | — | |
| last_backup_status | String | YES | — | |
| storage_bytes | BigInteger | YES | `0` | |
| discovered_at | DateTime | YES | `utcnow` | |
| archived_at | DateTime | YES | — | |
| deletion_queued_at | DateTime | YES | — | |
| created_at | DateTime | YES | `utcnow` | |
| updated_at | DateTime | YES | `utcnow` (onupdate) | |
| azure_subscription_id | String | YES | — | Azure workload meta |
| azure_resource_group | String | YES | — | |
| azure_region | String | YES | — | |
| parent_resource_id | UUID | YES | — | FK → resources.id (CASCADE), INDEX |

### Relationships
- `tenant = relationship("Tenant", foreign_keys=[tenant_id], lazy="raise")` — selectinload target for the scheduler dispatcher.

### Indexes
Implicit on `tenant_id`, `parent_resource_id`.

### Notes
Heart of the data model. Two-tier discovery: Tier-1 creates parent rows (e.g., `ENTRA_USER`); Tier-2 creates child rows (`MAILBOX`, `ONEDRIVE`, `USER_CONTACTS`, etc.) pointing at the parent via `parent_resource_id`. Column attribute named `extra_data` maps to DB column `metadata`.

---

## sla_policies
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| id | UUID | NO | `uuid.uuid4` | PK |
| tenant_id | UUID | NO | — | FK → tenants.id, INDEX |
| service_type | String | NO | `"m365"` | INDEX |
| name | String | NO | — | |
| frequency | String | YES | `"DAILY"` | |
| backup_days | ARRAY(String) | YES | `["MON","TUE","WED","THU","FRI","SAT","SUN"]` | |
| backup_window_start | String | YES | — | |
| backup_window_end | String | YES | — | |
| backup_exchange | Boolean | YES | `True` | |
| backup_exchange_archive | Boolean | YES | `False` | |
| backup_exchange_recoverable | Boolean | YES | `False` | |
| backup_onedrive | Boolean | YES | `True` | |
| backup_sharepoint | Boolean | YES | `True` | |
| backup_teams | Boolean | YES | `True` | |
| backup_teams_chats | Boolean | YES | `False` | |
| backup_entra_id | Boolean | YES | `True` | |
| backup_power_platform | Boolean | YES | `False` | |
| backup_copilot | Boolean | YES | `False` | |
| contacts | Boolean | YES | `True` | |
| calendars | Boolean | YES | `True` | |
| tasks | Boolean | YES | `False` | |
| group_mailbox | Boolean | YES | `True` | |
| planner | Boolean | YES | `False` | |
| backup_azure_vm | Boolean | YES | `True` | |
| backup_azure_sql | Boolean | YES | `True` | |
| backup_azure_postgresql | Boolean | YES | `True` | |
| resource_types | ARRAY(String) | YES | `[]` | |
| batch_size | Integer | YES | `20` | |
| max_concurrent_backups | Integer | YES | `50` | |
| sla_violation_alert | Boolean | YES | `True` | |
| retention_type | String | YES | `"INDEFINITE"` | |
| retention_days | Integer | YES | — | |
| retention_versions | Integer | YES | — | |
| retention_hot_days | Integer | NO | `7` | AZ-0 tiered retention |
| retention_cool_days | Integer | NO | `30` | |
| retention_archive_days | Integer | YES | — | NULL = unlimited |
| legal_hold_enabled | Boolean | NO | `False` | |
| legal_hold_until | DateTime | YES | — | |
| immutability_mode | String | NO | `"None"` | None/Unlocked/Locked |
| retention_mode | String | NO | `"FLAT"` | FLAT/GFS/ITEM_LEVEL/HYBRID |
| gfs_daily_count | Integer | YES | — | |
| gfs_weekly_count | Integer | YES | — | |
| gfs_monthly_count | Integer | YES | — | |
| gfs_yearly_count | Integer | YES | — | |
| item_retention_days | Integer | YES | — | |
| item_retention_basis | String | NO | `"SNAPSHOT"` | "SNAPSHOT"/"ITEM_DATE" |
| archived_retention_mode | String | NO | `"SAME"` | SAME/KEEP_ALL/KEEP_LAST/CUSTOM |
| archived_retention_days | Integer | YES | — | |
| encryption_mode | String | NO | `"VAULT_MANAGED"` | VAULT_MANAGED/CUSTOMER_KEY |
| key_vault_uri | String | YES | — | BYOK |
| key_name | String | YES | — | |
| key_version | String | YES | — | operator-stated intent |
| encryption_status | String | NO | `""` | reconciler-set: "" / OK / KEY_VAULT_ACCESS_DENIED / ERROR |
| lifecycle_dirty | Boolean | NO | `False` | INDEX; sweeper trigger |
| last_reconciled_at | DateTime | YES | — | |
| reconcile_attempts | Integer | NO | `0` | |
| key_version_resolved | String | YES | — | actual resolved CMK version |
| last_cap_alert_at | DateTime | YES | — | dedup attempt-cap alerts |
| auto_apply_to_matching | Boolean | NO | `False` | auto-apply hook |
| enabled | Boolean | YES | `True` | |
| is_default | Boolean | YES | `False` | |
| created_at | DateTime | YES | `utcnow` | |
| updated_at | DateTime | YES | `utcnow` (onupdate) | |

### Indexes
Implicit on `tenant_id`, `service_type`, `lifecycle_dirty`.

### Notes
Phantom `storage_region` was dropped (TMvault routes by single global active backend via `StorageRouter`). Retention has 4 schemes; archived resources get separate retention. Reconciler maintains `encryption_status`, `last_reconciled_at`, `reconcile_attempts`, `last_cap_alert_at`, `key_version_resolved`. The 5-minute sweeper picks up `lifecycle_dirty=True` rows.

---

## sla_exclusions
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| id | UUID | NO | `uuid.uuid4` | PK |
| policy_id | UUID | NO | — | FK → sla_policies.id (CASCADE), INDEX |
| exclusion_type | String | NO | — | FOLDER_PATH/FILE_EXTENSION/SUBJECT_REGEX/MIME_TYPE/EMAIL_ADDRESS/FILENAME_GLOB |
| pattern | String | NO | — | |
| workload | String | YES | — | EMAIL/FILE/CALENDAR/CONTACT/TEAMS_MESSAGE/CHAT_MESSAGE/ALL |
| apply_to_historical | Boolean | NO | `False` | |
| enabled | Boolean | NO | `True` | |
| created_at | DateTime | YES | `utcnow` | |
| updated_at | DateTime | YES | `utcnow` (onupdate) | |

### Notes
Exclusion rule attached to an SLA policy. `apply_to_historical=true` means an offline job should also purge matching items from prior snapshots.

---

## resource_groups
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| id | UUID | NO | `uuid.uuid4` | PK |
| tenant_id | UUID | NO | — | FK → tenants.id (CASCADE), INDEX |
| name | String | NO | — | |
| description | Text | YES | — | |
| group_type | String | NO | `"DYNAMIC"` | STATIC/DYNAMIC/PROVIDER_NATIVE |
| rules | JSON | NO | `[]` | list of {field, operator, value} |
| combinator | String | NO | `"AND"` | AND/OR |
| priority | Integer | NO | `100` | lower = higher priority |
| auto_protect_new | Boolean | NO | `False` | |
| enabled | Boolean | NO | `True` | |
| created_at | DateTime | YES | `utcnow` | |
| updated_at | DateTime | YES | `utcnow` (onupdate) | |

### Notes
Named group of resources. DYNAMIC = rules evaluated against resource attributes; STATIC = explicit list; priority breaks ties when a resource matches multiple groups (matches afi's Dynamic > Provider > Default ordering).

---

## group_policy_assignments
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| id | UUID | NO | `uuid.uuid4` | PK |
| group_id | UUID | NO | — | FK → resource_groups.id (CASCADE), INDEX |
| policy_id | UUID | NO | — | FK → sla_policies.id (CASCADE), INDEX |
| created_at | DateTime | YES | `utcnow` | |

### Notes
Link table connecting SLA policies to resource groups.

---

## jobs
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| id | UUID | NO | `uuid.uuid4` | PK |
| type | Enum(JobType) | NO | — | |
| tenant_id | UUID | YES | — | FK → tenants.id, INDEX |
| resource_id | UUID | YES | — | FK → resources.id |
| batch_resource_ids | ARRAY(UUID) | YES | `[]` | mass backup |
| snapshot_id | UUID | YES | — | FK → snapshots.id |
| status | Enum(JobStatus) | YES | `QUEUED` | |
| priority | Integer | YES | `5` | |
| attempts | Integer | YES | `0` | |
| max_attempts | Integer | YES | `5` | |
| error_message | Text | YES | — | |
| progress_pct | Integer | YES | `0` | |
| items_processed | BigInteger | YES | `0` | |
| bytes_processed | BigInteger | YES | `0` | |
| result | JSON | YES | `{}` | |
| spec | JSON | YES | `{}` | |
| created_at | DateTime | YES | `utcnow` | |
| updated_at | DateTime | YES | `utcnow` (onupdate) | |
| completed_at | DateTime | YES | — | |
| retry_reason | Text | YES | — | storage toggle retry plumbing |
| pre_toggle_job_id | UUID | YES | — | FK → jobs.id (self-ref) |
| lease_owner_id | UUID | YES | — | distributed reconciliation lease |
| lease_expires_at | DateTime(tz) | YES | — | |
| lease_token | BigInteger | NO | `0` | |
| requeue_count | Integer | NO | `0` | |

### Notes
Unit of work tracking. Holds distributed reconciliation lease (2026-05-16 design). Job row's own `progress_pct` / `items_processed` are write-once-at-terminal — read paths derive live values from `snapshots`.

---

## backup_batches
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| id | UUID | NO | `uuid.uuid4` | PK |
| tenant_id | UUID | NO | — | INDEX |
| created_at | DateTime | NO | `utcnow` | |
| completed_at | DateTime | YES | — | |
| source | String | NO | — | 'manual_bulk'/'manual_user'/'scheduler' |
| actor_email | String | YES | — | |
| scope_user_ids | ARRAY(UUID) | NO | — | |
| bytes_expected | BigInteger | YES | — | |
| status | String | NO | `"IN_PROGRESS"` | |

### Notes
Operator-intent row for one "Backup all" / "Backup user" click. Inserted at click time. Every Job, RMQ message, and discovery follow-up stamps `spec.batch_id` = this.id. Strict 4-condition finalizer (`shared.batch_rollup._finalize_batch_if_complete`) flips status terminal only when every scoped leaf has a terminal snapshot AND no `snapshot_partitions` row remains in-flight.

---

## snapshots
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| id | UUID | NO | `uuid.uuid4` | PK |
| resource_id | UUID | NO | — | FK → resources.id, INDEX |
| job_id | UUID | YES | — | FK → jobs.id |
| type | Enum(SnapshotType) | YES | `INCREMENTAL` | |
| status | Enum(SnapshotStatus) | YES | `IN_PROGRESS` | |
| started_at | DateTime | YES | `utcnow` | |
| completed_at | DateTime | YES | — | |
| duration_secs | Integer | YES | — | |
| item_count | Integer | YES | `0` | |
| new_item_count | Integer | YES | `0` | |
| bytes_added | BigInteger | YES | `0` | |
| bytes_total | BigInteger | YES | `0` | |
| delta_token | String | YES | — | |
| delta_tokens_json | JSON (MutableDict) | YES | `{}` | per-folder/resource |
| extra_data | JSON (MutableDict) | YES | `{}` | VM config blobs, disk info |
| snapshot_label | String | YES | — | |
| content_checksum | String | YES | — | SHA-256 of stored blob |
| blob_path | String | YES | — | Azure Blob path |
| storage_version | Integer | YES | `1` | |
| azure_restore_point_id | String | YES | — | VM restore point id |
| azure_operation_id | String | YES | — | in-flight Azure LRO id |
| dr_replication_status | String | NO | `"pending"` | pending/in_progress/replicated/failed/skipped |
| dr_blob_path | String | YES | — | |
| dr_replicated_at | DateTime | YES | — | |
| dr_error | Text | YES | — | |
| dr_replication_attempts | Integer | NO | `0` | |
| backend_id | UUID | NO | — | FK → storage_backends.id |
| reuse_of_snapshot_id | UUID | YES | — | FK → snapshots.id (RESTRICT) — snapshot-reuse parent |
| reuse_chain_root_id | UUID | YES | — | FK → snapshots.id (RESTRICT) — denormalised terminal ancestor |
| lease_owner_id | UUID | YES | — | reconciliation lease |
| lease_expires_at | DateTime(tz) | YES | — | |
| lease_token | BigInteger | NO | `0` | |
| requeue_count | Integer | NO | `0` | |
| hc_drain_status | String(16) | NO | `"NOT_APPLICABLE"` | NOT_APPLICABLE/PENDING/COMPLETE/FAILED |
| created_at | DateTime | YES | `utcnow` | |

### Indexes
- `ix_snapshots_job_resource_inprogress` — UNIQUE `(job_id, resource_id)` WHERE `status = 'IN_PROGRESS'` (partial). Per-resource single-claim guarantee under RMQ redelivery — only the active claim is unique; historical terminal-state rows coexist.

### Notes
Snapshot of one resource's content at a point in time. Reuse chain: a "reuse" snapshot owns ZERO `snapshot_items`; reads resolve via `reuse_chain_root_id` to the row-bearing ancestor. Validation trigger (in `shared/database.py:snapshots_reuse_validate`) enforces same-tenant/same-resource/COMPLETED/earlier-`started_at` on the parent. `hc_drain_status` gates restore-readiness for chat snapshots (HC = hostedContent inline images). Helper `snapshot_is_restore_ready()` exposes the check.

---

## snapshot_items
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| id | UUID | NO | `uuid.uuid4` | PK |
| snapshot_id | UUID | NO | — | FK → snapshots.id, INDEX |
| tenant_id | UUID | YES | — | FK → tenants.id, INDEX |
| external_id | String | NO | — | |
| parent_external_id | String | YES | — | INDEX |
| item_type | String | NO | — | |
| name | String | NO | — | |
| folder_path | String | YES | — | |
| content_hash | String | YES | — | INDEX |
| content_checksum | String | YES | — | SHA-256 integrity |
| content_size | BigInteger | YES | `0` | |
| blob_path | String | YES | — | Azure Blob path |
| encryption_key_id | String | YES | — | DEK version used |
| backup_version | Integer | YES | `1` | |
| extra_data (db: `metadata`) | JSON | YES | `{}` | |
| is_deleted | Boolean | YES | `False` | |
| indexed_at | DateTime | YES | — | |
| backend_id | UUID | NO | — | FK → storage_backends.id |
| created_at | DateTime | YES | `utcnow` | |

### Notes
Individual item inside a snapshot. `backend_id` wins over `system_config.active_backend_id` during passthrough restores. Attribute `extra_data` maps to DB column `metadata`.

---

## snapshot_partitions
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| id | UUID | NO | `uuid.uuid4` | PK |
| snapshot_id | UUID | NO | — | FK → snapshots.id (CASCADE), INDEX |
| tenant_id | UUID | NO | — | |
| resource_id | UUID | NO | — | |
| job_id | UUID | NO | — | |
| partition_type | String | NO | `"ONEDRIVE_FILES"` | ONEDRIVE_FILES/CHATS/MAIL_FOLDERS/SHAREPOINT_DRIVES |
| drive_id | Text | YES | — | legacy OneDrive |
| partition_index | Integer | NO | — | |
| file_ids | JSON | YES | — | legacy OneDrive shard payload |
| payload | JSON | YES | — | generic shard payload |
| total_files | Integer | NO | `0` | |
| total_bytes_est | BigInteger | NO | `0` | |
| status | String | NO | `"QUEUED"` | QUEUED/IN_PROGRESS/COMPLETED/FAILED |
| worker_id | String | YES | — | |
| worker_region | String | YES | — | observability for multi-region |
| retry_count | Integer | NO | `0` | partition stale-sweep counter |
| enqueued_at | DateTime | NO | `utcnow` | |
| started_at | DateTime | YES | — | |
| completed_at | DateTime | YES | — | |
| files_uploaded | Integer | NO | `0` | |
| bytes_uploaded | BigInteger | NO | `0` | |
| failure_state | JSON | YES | — | |
| lease_owner_id | UUID | YES | — | reconciliation lease |
| lease_expires_at | DateTime(tz) | YES | — | |
| lease_token | BigInteger | NO | `0` | |
| requeue_count | Integer | NO | `0` | reconciler-sweep counter |

### Indexes
- `uq_snap_partition` — UNIQUE `(snapshot_id, partition_index)`. Re-publish of same partition under crash hits this constraint; INSERTs use `ON CONFLICT DO NOTHING` for idempotent fan-out.
- `ix_snap_partition_status` — `(snapshot_id, status)`. Hot read path for finalizer + stale-sweep.
- `ix_snap_partition_claim` — `(enqueued_at)` WHERE `status IN ('QUEUED','IN_PROGRESS')` (partial). Stale-sweep ordering.

### Notes
Per-shard tracking for a partitioned Snapshot. Last shard to terminate flips parent Snapshot via `_finalize_partitioned_snapshot`. Cap = `PARTITION_MAX_RETRIES` (default 5). Both `retry_count` (stale-sweep) and `requeue_count` (reconciler) coexist.

---

## mail_folder_delta
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| resource_id | UUID | NO | — | PK, FK → resources.id (CASCADE) |
| folder_id | Text | NO | — | PK |
| delta_token | Text | NO | — | |
| updated_at | DateTime | NO | `utcnow` (onupdate) | |

### Notes
Per-folder delta token for mailbox-style resources. Replaces the JSON dict in `resource.extra_data["mail_delta_tokens_by_folder"]` that suffered RMW races. Per-row PG atomicity makes concurrent UPSERTs commute. Covers `USER_MAIL`/`MAILBOX`/`SHARED_MAILBOX`/`ROOM_MAILBOX`.

---

## mail_folder_fingerprint
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| resource_id | UUID | NO | — | PK, FK → resources.id (CASCADE) |
| folder_id | Text | NO | — | PK |
| total_item_count | Integer | NO | `0` | |
| unread_item_count | Integer | NO | `0` | |
| size_in_bytes | BigInteger | NO | `0` | |
| baseline_at | DateTime | NO | `utcnow` (onupdate) | |

### Notes
Per-folder Graph fingerprint for `USER_MAIL` skip-by-fp. Mirrors `mail_folder_delta`. Replaces the whole-mailbox JSON dict that was clobbered when sibling MAIL_FOLDERS shards finished sequentially. `baseline_at` is per-folder so the 3-day full-rescan window applies per-folder.

---

## batch_pending_users
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| batch_id | UUID | NO | — | PK, FK → backup_batches.id (CASCADE) |
| user_id | UUID | NO | — | PK, FK → resources.id (CASCADE) |
| state | Text | NO | — | WAITING_DISCOVERY/BACKUP_ENQUEUED/NO_CONTENT/DISCOVERY_FAILED |
| deadline_at | DateTime | NO | — | watchdog deadline |
| updated_at | DateTime | NO | `utcnow` (onupdate) | |

### Notes
Per-user state in a backup batch when the user's backup is deferred until Tier-2 discovery completes. Composite PK `(batch_id, user_id)`. Finalizer accepts any terminal state as gate-1 pass.

---

## sharepoint_drive_delta
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| resource_id | UUID | NO | — | PK, FK → resources.id (CASCADE) |
| drive_id | Text | NO | — | PK |
| delta_token | Text | NO | — | |
| updated_at | DateTime | NO | `utcnow` (onupdate) | |

### Notes
Per-drive delta token for SharePoint sites. Same RMW-fix pattern as `mail_folder_delta` for `extra_data["drive_delta_tokens_by_site"]`.

---

## bulk_fanout_seen
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| job_id | UUID | NO | — | PK, FK → jobs.id (CASCADE) |
| resource_id | UUID | NO | — | PK, FK → resources.id (CASCADE) |
| created_at | DateTime | NO | `utcnow` | |

### Notes
Per-resource dedup marker for bulk-fanout publish. `_fanout_bulk_to_per_resource` inserts one row per `(job_id, resource_id)` BEFORE publishing. ON CONFLICT DO NOTHING makes redelivery a no-op. Stale-sweep prunes rows older than 24h; growth bounded (~5k × 8 = 40k rows per bulk run).

---

## job_logs
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| id | UUID | NO | `uuid.uuid4` | PK |
| job_id | UUID | NO | — | FK → jobs.id, INDEX |
| timestamp | DateTime | YES | `utcnow` | |
| level | String | YES | `"INFO"` | |
| message | Text | NO | — | |
| details | Text | YES | — | |

### Notes
Per-job log entries.

---

## alerts
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| id | UUID | NO | `uuid.uuid4` | PK |
| tenant_id | UUID | YES | — | FK → tenants.id, INDEX |
| org_id | UUID | YES | — | FK → organizations.id |
| type | String | NO | — | |
| severity | String | NO | `"MEDIUM"` | |
| message | Text | NO | — | |
| resource_id | UUID | YES | — | (no FK declared) |
| resource_type | String | YES | — | |
| resource_name | String | YES | — | |
| triggered_by | String | YES | — | |
| resolved | Boolean | YES | `False` | |
| resolved_at | DateTime | YES | — | |
| resolved_by | UUID | YES | — | |
| resolution_note | Text | YES | — | |
| details | JSON | YES | `{}` | |
| created_at | DateTime | YES | `utcnow` | |
| updated_at | DateTime | YES | `utcnow` (onupdate) | |

### Notes
Generic alert table (SLA violations, key vault access denied, etc.).

---

## access_groups
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| id | UUID | NO | `uuid.uuid4` | PK |
| org_id | UUID | YES | — | FK → organizations.id |
| tenant_id | UUID | YES | — | FK → tenants.id |
| name | String | NO | — | |
| description | String | YES | — | |
| scope | String | YES | `"TENANT"` | |
| resource_ids | ARRAY(UUID) | YES | `[]` | |
| permissions | JSON | YES | `{}` | |
| member_ids | ARRAY(UUID) | YES | `[]` | |
| active | Boolean | YES | `True` | |
| created_at | DateTime | YES | `utcnow` | |
| updated_at | DateTime | YES | `utcnow` (onupdate) | |

### Notes
Role/permission grouping. Members + resources stored as ARRAY columns; permissions as JSON.

---

## audit_events
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| id | UUID | NO | `uuid.uuid4` | PK |
| org_id | UUID | YES | — | FK → organizations.id, INDEX |
| tenant_id | UUID | YES | — | FK → tenants.id, INDEX |
| actor_id | UUID | YES | — | |
| actor_email | String | YES | — | |
| actor_type | String | YES | `"SYSTEM"` | USER/SYSTEM/WORKER |
| action | String | NO | — | INDEX (e.g., BACKUP_COMPLETED) |
| resource_id | UUID | YES | — | |
| resource_type | String | YES | — | |
| resource_name | String | YES | — | |
| outcome | String | YES | `"SUCCESS"` | SUCCESS/FAILURE/PARTIAL |
| job_id | UUID | YES | — | |
| snapshot_id | UUID | YES | — | |
| details | JSON | YES | `{}` | |
| occurred_at | DateTime | NO | `utcnow` | INDEX |

### Notes
Append-only audit log.

---

## admin_consent_tokens
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| id | UUID | NO | `uuid.uuid4` | PK |
| org_id | UUID | YES | — | FK → organizations.id, INDEX |
| tenant_id | UUID | YES | — | FK → tenants.id, INDEX |
| consent_type | String | NO | — | INDEX (M365 or AZURE) |
| access_token_encrypted | LargeBinary | YES | — | |
| refresh_token_encrypted | LargeBinary | YES | — | |
| token_type | String | YES | `"Bearer"` | |
| expires_at | DateTime | YES | — | |
| granted_by | String | YES | — | email of grantor |
| consented_at | DateTime | YES | `utcnow` | |
| last_used_at | DateTime | YES | — | |
| is_active | Boolean | YES | `True` | INDEX |
| scope | String | YES | — | space-separated scopes |
| created_at | DateTime | YES | `utcnow` | |
| updated_at | DateTime | YES | `utcnow` (onupdate) | |

### Notes
Encrypted admin-consent tokens per tenant per consent type.

---

## discovery_runs
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| id | UUID | NO | `uuid.uuid4` | PK |
| tenant_id | UUID | NO | — | FK → tenants.id, INDEX |
| scope | JSON | NO | `[]` | |
| status | String | NO | `"RUNNING"` | INDEX |
| fetched_count | Integer | NO | `0` | |
| staged_count | Integer | NO | `0` | |
| inserted_count | Integer | NO | `0` | |
| updated_count | Integer | NO | `0` | |
| unchanged_count | Integer | NO | `0` | |
| stale_marked_count | Integer | NO | `0` | |
| error_message | Text | YES | — | |
| started_at | DateTime | NO | `utcnow` | |
| finished_at | DateTime | YES | — | |
| created_at | DateTime | YES | `utcnow` | |
| updated_at | DateTime | YES | `utcnow` (onupdate) | |

### Notes
Tracks a discovery sweep over a tenant.

---

## resource_discovery_staging
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| id | BigInteger (autoincrement) | NO | — | PK |
| run_id | UUID | NO | — | FK → discovery_runs.id, INDEX |
| tenant_id | UUID | NO | — | FK → tenants.id, INDEX |
| resource_type | String | NO | — | |
| external_id | String | NO | — | |
| display_name | String | NO | — | |
| email | String | YES | — | |
| extra_data (db: `metadata`) | JSON (MutableDict) | YES | `{}` | |
| resource_status | String | NO | `"DISCOVERED"` | |
| resource_hash | String | YES | — | |
| azure_subscription_id | String | YES | — | |
| azure_resource_group | String | YES | — | |
| azure_region | String | YES | — | |
| discovered_at | DateTime | NO | `utcnow` | |
| created_at | DateTime | YES | `utcnow` | |

### Notes
Staging table populated during discovery before merge into `resources`. Attribute `extra_data` maps to DB column `metadata`.

---

## report_configs
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| id | UUID | NO | `uuid.uuid4` | PK |
| org_id | UUID | YES | — | FK → organizations.id, INDEX |
| enabled | Boolean | NO | `False` | |
| schedule_type | String | NO | `"daily"` | daily/weekly/monthly |
| send_empty_report | Boolean | NO | `True` | |
| empty_message | String | YES | `"No updates. No backups occurred."` | |
| send_detailed_report | Boolean | NO | `False` | |
| email_recipients | JSON | YES | `[]` | |
| slack_webhooks | JSON | YES | `[]` | |
| teams_webhooks | JSON | YES | `[]` | |
| created_at | DateTime | YES | `utcnow` | |
| updated_at | DateTime | YES | `utcnow` (onupdate) | |

### Notes
Schedule + delivery config for periodic reports.

---

## report_history
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| id | UUID | NO | `uuid.uuid4` | PK |
| org_id | UUID | YES | — | FK → organizations.id, INDEX |
| report_config_id | UUID | YES | — | FK → report_configs.id |
| report_type | String | NO | — | DAILY/WEEKLY/MONTHLY |
| period_start | DateTime | YES | — | |
| period_end | DateTime | YES | — | |
| generated_at | DateTime | NO | `utcnow` | |
| total_backups | Integer | YES | `0` | |
| successful_backups | Integer | YES | `0` | |
| failed_backups | Integer | YES | `0` | |
| success_rate | String | YES | — | |
| coverage_rate | String | YES | — | |
| report_data | JSON | YES | `{}` | |
| is_empty | Boolean | NO | `False` | |
| delivery_status | JSON | YES | `{}` | |
| error_message | Text | YES | — | |
| created_at | DateTime | YES | `utcnow` | |

### Notes
Historical generated reports + delivery audit.

---

## tenant_secrets
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| id | UUID | NO | `uuid.uuid4` | PK |
| tenant_id | UUID | NO | — | FK → tenants.id (CASCADE), INDEX |
| type | String | NO | — | INDEX (SQL_SERVER_LOGIN/POSTGRESQL_LOGIN/AES_256_KEY) |
| name | String | NO | — | |
| description | Text | YES | — | |
| metadata_hints | JSON | YES | `{}` | safe-to-render hints |
| encrypted_payload | Text | YES | — | opaque base64 (shared.security.encrypt_secret) |
| is_default | Boolean | NO | `False` | |
| created_at | DateTime | NO | `utcnow` | |
| updated_at | DateTime | NO | `utcnow` (onupdate) | |

### Notes
Credentials + KMS-key references reused across restore + other operations. Payloads never returned to frontend; `metadata_hints` carries non-sensitive fields for list rendering.

---

## vm_file_index
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| id | UUID | NO | `uuid.uuid4` | PK |
| snapshot_id | UUID | NO | — | FK → snapshots.id (CASCADE), INDEX |
| volume_item_id | UUID | NO | — | INDEX |
| parent_path | String | NO | — | INDEX |
| name | String | NO | — | |
| is_directory | Boolean | NO | `False` | |
| size_bytes | BigInteger | NO | `0` | |
| modified_at | DateTime | YES | — | |
| fs_inode | BigInteger | YES | — | |
| fs_type | String | YES | — | |
| partition_offset | BigInteger | YES | — | |
| blob_path | String | YES | — | |
| extents_json | JSON | YES | — | TSK-level extents |
| created_at | DateTime | NO | `utcnow` | |

### Notes
Per-file/per-directory index from walking a VHD snapshot captured during an Azure VM backup. Lets the Volumes tab browse + download files from the *backup* (not the live VM) — so locked files, stopped VMs, and deleted files remain recoverable. Hot query: `(snapshot_id, volume_item_id, parent_path)` for directory listing.

---

## storage_backends
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| id | UUID | NO | `uuid.uuid4` | PK |
| kind | String | NO | — | azure_blob/seaweedfs |
| name | String | NO | — | UNIQUE |
| endpoint | String | NO | — | |
| config | JSONB | NO | `{}` | |
| secret_ref | String | NO | — | |
| is_enabled | Boolean | NO | `True` | |
| created_at | DateTime(tz) | YES | `utcnow` | |
| updated_at | DateTime(tz) | YES | `utcnow` (onupdate) | |

### Notes
Registry of storage backends.

---

## system_config
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| id | SmallInteger | NO | — | PK |
| active_backend_id | UUID | NO | — | FK → storage_backends.id |
| transition_state | String | NO | `"stable"` | stable/draining/flipping |
| last_toggle_at | DateTime(tz) | YES | — | |
| cooldown_until | DateTime(tz) | YES | — | |
| updated_at | DateTime(tz) | YES | `utcnow` (onupdate) | |

### Notes
Singleton row holding the currently-active storage backend + transition state.

---

## storage_toggle_events
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| id | UUID | NO | `uuid.uuid4` | PK |
| actor_id | UUID | NO | — | |
| actor_ip | INET | YES | — | |
| from_backend_id | UUID | NO | — | FK → storage_backends.id |
| to_backend_id | UUID | NO | — | FK → storage_backends.id |
| reason | String | YES | — | |
| status | String | NO | `"started"` | |
| started_at | DateTime(tz) | YES | `utcnow` | |
| drain_completed_at | DateTime(tz) | YES | — | |
| flip_completed_at | DateTime(tz) | YES | — | |
| completed_at | DateTime(tz) | YES | — | |
| error_message | Text | YES | — | |
| pre_flight_checks | JSONB | YES | — | |
| drained_job_count | Integer | YES | — | |
| retried_job_count | Integer | YES | — | |

### Notes
Audit row per backend toggle.

---

## chat_url_cache
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| tenant_id | UUID | NO | — | PK, FK → tenants.id (CASCADE) |
| url_sha256 | String(64) | NO | — | PK |
| drive_item_id | String(256) | YES | — | |
| content_hash | String(64) | YES | — | |
| blob_path | Text | YES | — | |
| content_size | BigInteger | YES | — | |
| inline_b64 | Text | YES | — | |
| unreachable | Boolean | NO | `False` | |
| first_seen_at | DateTime(tz) | NO | `utcnow` | |
| last_used_at | DateTime(tz) | NO | `utcnow` | |

### Notes
Tenant-scoped cache of chat-attachment URL → driveItem resolution. Keyed by SHA-256 of the SharePoint share URL. A hit short-circuits both the Graph `/shares/{id}/driveItem` resolve and the SharePoint CDN download — caller reuses existing `blob_path` (or `inline_b64`). `unreachable=True` set on permanent 4xx so subsequent backups skip broken URLs.

---

## chat_threads
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| id | UUID | NO | `uuid.uuid4` | PK |
| tenant_id | UUID | NO | — | FK → tenants.id (RESTRICT), INDEX |
| chat_id | String(256) | NO | — | |
| chat_type | String(32) | YES | — | oneOnOne/group/meeting_* |
| chat_topic | Text | YES | — | group name; null for 1:1 |
| member_names_json | JSONB | YES | — | members at last drain |
| last_updated_at | DateTime(tz) | YES | — | mirrors chat.lastUpdatedDateTime |
| last_drained_at | DateTime(tz) | YES | — | claim freshness anchor |
| drain_cursor | Text | YES | — | |
| drain_failure_state | JSONB | YES | — | |
| last_drained_msg_count | Integer | YES | — | drain-completeness gate baseline |
| archived_at | DateTime(tz) | YES | — | P2 soft delete |
| created_at | DateTime(tz) | NO | `utcnow` | |
| updated_at | DateTime(tz) | NO | `utcnow` (onupdate) | |

### Notes
Singleton row per `(tenant_id, chat_id)`. Stores the cross-user drain claim, chat metadata, per-chat drain cursor/failure state (relocated from `Resource.extra_data` so it's tenant-scoped). Drain mechanic: each backup runs `INSERT…ON CONFLICT DO UPDATE` bumping `last_drained_at` only if existing row is older than the freshness window; `RETURNING (xmax = 0)` tells the worker whether it won (drain) or lost (skip + reuse). RESTRICT FK so an accidental tenant DELETE fails loud. `last_drained_msg_count` added by migration `20260517_0003` — supports the completeness gate that rejects drains dropping >`CHAT_DRAIN_COMPLETENESS_DROP_PCT`% messages.

---

## mail_message_bodies
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| id | UUID | NO | `uuid.uuid4` | PK |
| tenant_id | UUID | NO | — | FK → tenants.id (RESTRICT), INDEX |
| fingerprint | String(64) | NO | — | dedup key |
| first_user_id | String(128) | YES | — | |
| first_snapshot_id | UUID | YES | — | |
| from_user_id | String(128) | YES | — | |
| from_address | String(256) | YES | — | |
| from_display_name | String(256) | YES | — | |
| subject | Text | YES | — | |
| sent_date_time | DateTime(tz) | YES | — | |
| received_date_time | DateTime(tz) | YES | — | |
| body_content | Text | YES | — | |
| body_content_type | String(16) | YES | — | |
| has_attachments | Boolean | YES | — | |
| metadata_raw | JSONB | YES | — | full Graph payload |
| content_hash | String(64) | YES | — | |
| content_size | BigInteger | YES | — | |
| ref_count | Integer | NO | `1` | |
| last_referenced_at | DateTime(tz) | NO | `utcnow` (onupdate) | |
| created_at | DateTime(tz) | NO | `utcnow` | |

### Notes
Cross-user mail body store (2026-05-17). Mirrors `chat_thread_messages` — dedup body bytes across snapshots/users in one tenant. Dedup key: `fingerprint = sha256(from + sentDateTime + subject + body_size + body_first_64KB_hash)`. UNIQUE `(tenant_id, fingerprint)` is enforced at DB level (DDL in `shared/database.py`). Phase 1: write-only (bodies live in BOTH `snapshot_items.extra_data` AND here). Phase 2: switch restore to JOIN here; stop writing body to `snapshot_items.extra_data`. Post-retention purge walks bodies with `ref_count=0` + `last_referenced_at` older than cap.

---

## chat_thread_messages
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| id | UUID | NO | `uuid.uuid4` | PK |
| chat_thread_id | UUID | NO | — | FK → chat_threads.id (RESTRICT), INDEX |
| message_external_id | String(256) | NO | — | |
| created_date_time | DateTime(tz) | YES | — | |
| last_modified_date_time | DateTime(tz) | YES | — | |
| from_user_id | String(128) | YES | — | |
| from_display_name | String(256) | YES | — | |
| body_content | Text | YES | — | |
| body_content_type | String(16) | YES | — | |
| deleted_date_time | DateTime(tz) | YES | — | |
| metadata_raw | JSONB | YES | — | full Graph payload |
| content_hash | String(64) | YES | — | |
| content_size | BigInteger | YES | — | |
| archived_at | DateTime(tz) | YES | — | P2 soft delete |
| created_at | DateTime(tz) | NO | `utcnow` | |

### Notes
Tenant-scoped, drained-once-per-batch chat message store. `snapshot_items` carries a thin pointer row per `(snapshot, message)` keyed by `parent_external_id=chat_id + external_id=message_external_id`; reads JOIN here to hydrate body+sender+attachments. `metadata_raw` holds the full Graph payload (attachments, mentions, reactions, hostedContents).

---

## onedrive_file_retries
### Columns
| Column | Type | Null | Default | PK/FK/Index |
|---|---|---|---|---|
| id | UUID | NO | `uuid.uuid4` | PK |
| tenant_id | UUID | NO | — | FK → tenants.id (CASCADE), INDEX |
| resource_id | UUID | NO | — | FK → resources.id (CASCADE), INDEX |
| snapshot_id | UUID | NO | — | FK → snapshots.id (CASCADE), INDEX |
| file_external_id | String(256) | NO | — | |
| file_name | Text | YES | — | |
| drive_id | Text | YES | — | |
| file_payload | JSONB | NO | — | full Graph file dict |
| attempt_count | Integer | NO | `0` | |
| last_error | Text | YES | — | |
| last_error_class | String(32) | YES | — | throttle/stream_drop/permanent/unknown |
| next_retry_at | DateTime(tz) | NO | `utcnow` | |
| status | String(16) | NO | `"PENDING"` | PENDING/IN_PROGRESS/RESCUED/FAILED_PERMANENT |
| rescued_snapshot_item_id | UUID | YES | — | |
| created_at | DateTime(tz) | NO | `utcnow` | |
| updated_at | DateTime(tz) | NO | `utcnow` (onupdate) | |

### Notes
OneDrive per-file retry queue (2026-05-17). Files that exhaust their inline resume budget no longer block snapshot completion — main gather records a row here; a separate consumer drains it at its own pace. On success, rescued bytes are UPSERTed into `snapshot_items` (idempotent on `(snapshot_id, external_id, item_type)`) pointing at the ORIGINAL snapshot. `UNIQUE(snapshot_id, file_external_id)` enforced via DDL in `shared/database.py`.

---

# Schemas (Pydantic)

The Pydantic schemas in `shared/schemas.py` are request/response DTOs only — no DB persistence. Naming convention is camelCase in JSON (with `populate_by_name=True` + aliases mapping to snake_case ORM attributes for `from_attributes` reads).

Groups:
- **Auth**: `UserResponse`, `LoginResponse`, `RefreshTokenRequest`, `RefreshTokenResponse`, `MicrosoftAuthUrlResponse`, `OAuthCallbackRequest`, `DatasourceConsentRequest`, `DatasourceCallbackResponse`
- **Dashboard**: `DashboardOverview`, `BackupStatus24Hour`, `DailyStatus`, `ProtectionStatusItem`, `ProtectionStatus`, `BackupSizeDailyData`, `BackupSize`
- **Tenant**: `TenantResponse`, `TenantCreateRequest`, `TenantInfoResponse`, `UsageReportEntry`, `DiscoveryStatus`, `StorageSummaryItem`, `OrganizationResponse`
- **Resource**: `ResourceResponse`, `ResourceListResponse`, `UserResourceResponse`, `AssignPolicyRequest`, `BulkOperationRequest`, `BulkAssignRequest`, `BulkUnassignRequest`
- **Job**: `JobResponse`, `JobListResponse`, `TriggerBackupRequest`, `TriggerBulkBackupRequest` (includes `batchId`, `tier2`), `TriggerDatasourceBackupRequest`
- **Snapshot**: `SnapshotResponse` (includes `batchId`, `partitions`), `SnapshotItemResponse` (includes `blobPath`), `SnapshotListResponse`, `SnapshotItemListResponse`, `SnapshotDiff`
- **SLA Policy**: `SlaPolicyResponse`, `SlaPolicyCreateRequest` — full alias mapping for camel ↔ snake.
- **SLA Exclusions + Resource Groups**: `SlaExclusionRequest`, `SlaExclusionResponse`, `ResourceGroupRule`, `ResourceGroupRequest`, `ResourceGroupResponse` (includes `attachedPolicyIds`), `GroupPolicyAssignmentRequest`
- **Alert**: `AlertResponse`, `AlertListResponse`
- **Access Group**: `AccessGroupResponse`, `AccessGroupListResponse`
- **Admin Consent**: `AdminConsentResponse`, `AdminConsentTokenResponse`
- **Power BI**: `PowerBIOAuthCallbackRequest`, `PowerBIReadinessCheckResponse`, `PowerBIReadinessResponse`
- **Storage Toggle**: `StorageBackendOut`, `SystemConfigOut`, `ToggleRequest` (validates `reason` min_length=10), `PreflightCheckOut`, `PreflightResultOut`, `ToggleEventOut`, `ToggleStatusOut`

Common validators: `uuid_to_str` (UUID → str), `datetime_to_str` (datetime → isoformat) on response models.

---

# Summary

- **Tables:** 38
- **Enums:** 12
- **Total columns across all tables:** 548
- **Alembic versions:** 3 (most recent: `20260517_0003_chat_drain_completeness_baseline.py`)
- **Pydantic schema classes:** ~50 (auth, dashboard, tenant, resource, job, snapshot, SLA policy + exclusions + groups, alert, access group, admin consent, Power BI, storage toggle)
