# TMvault — SeaweedFS Sharded Deployment (CURRENT architecture)

> **⚠️ DR / rebuild-critical.** The SeaweedFS coordinator is now **volume-less** —
> it stores **zero blobs** by itself. If you deploy only the coordinator (e.g.
> a from-scratch rebuild, new customer/server, or recreating the `seaweedfs`
> service from the repo) **without the volume-server services, every backup
> write fails** with `no writable volumes` and the system can't store a single
> byte. The volume servers + their volumes + `SEAWEED_MASTER` wiring are
> **runtime setup that is not in the repo** — follow §3 to recreate them.

This supersedes the single-node assumptions in `STORAGE_ARCHITECTURE.md`
(§4.3, §8.4) which describe the *old* all-in-one SeaweedFS. As of 2026-06,
on-prem storage is a **sharded cluster**: one coordinator + N volume servers.

---

## 1. Why sharding (the problem it fixes)

The old single all-in-one SeaweedFS instance (master+volume+filer+s3 in one
container, one disk) **OOM-crashed under heavy OneDrive write load**: data
arrived from Graph faster than one disk could flush, dirty pages piled up past
the container's RAM, and the cgroup OOM-killed it. It also hit a per-instance
`-volume.max` capacity wall and filled/`read-only`-d under imbalance.

**Sharding fixes this structurally:**
- **N volume servers = N independent disks = ~N× aggregate flush rate** — each
  server only writes ~1/N of the load, so its disk keeps up and dirty pages
  drain instead of accumulating.
- **The coordinator holds no blobs** → it physically cannot dirty-page OOM.
- Combined with **worker backpressure** (`ONEDRIVE_HUGE_FILE_RAM_BUDGET_GIB`)
  and **S3 client timeouts** (fail-fast on a slow/down server), the
  "ingest > flush" OOM condition no longer forms.

Validated 2026-06: a single 126 GB OneDrive (+ a 10-user mass backup, 131 GB
total) completed with **0 OOM, peak dirty pages ~3 GB vs 22 GiB RAM**.

---

## 2. Architecture

```
                         workers (backup/restore)
                                  │ S3 (ONPREM_S3_ENDPOINT)
                                  ▼
   ┌─────────────────────────────────────────────┐
   │  seaweedfs  (COORDINATOR — volume-less)       │
   │  weed master(:9333) + filer(:8888) + s3(:8333)│
   │  /data = metadata only (master + filer leveldb)│
   └───────────────┬───────────────┬──────────────┘
        master balances writes by free space
        ┌──────────┼───────────┬───────────┐
        ▼          ▼           ▼           ▼
  seaweedfs-vol-1  -vol-2     -vol-3      -vol-4   (VOLUME SERVERS)
  weed volume      weed vol   weed vol    weed vol
  /data = blobs    /data      /data       /data
  (own Railway     (own vol)  (own vol)   (own vol)
   volume)
```

- **Coordinator** (`seaweedfs` service, image `deploy/railway/seaweedfs/`):
  runs `weed master + filer + s3` and **no local volume server**. Holds only
  metadata. Exposes the S3 API the workers use. Entry point launches the 3
  processes itself (it does not use `weed server`).
- **Volume servers** (`seaweedfs-vol-1..N`, image
  `deploy/railway/seaweedfs-volume/`): each runs `weed volume`, registers with
  the coordinator's master (`-mserver`), advertises its own
  `RAILWAY_PRIVATE_DOMAIN` (binds `0.0.0.0`), and stores blobs on its own
  Railway volume at `/data`.
- The **master places each new volume on the emptiest server** and rolls a
  volume over every `SEAWEED_VOLUME_SIZE_LIMIT_MB` (5 GB) — small volumes ⇒
  fine-grained, even spread across all servers under load.

**Current deployment:** 1 coordinator + **4 volume servers**, each vol server
**73 GB disk / ~22 GiB RAM**.

---

## 3. Deploy / rebuild steps (the runtime setup not in the repo)

### 3.1 Coordinator (`seaweedfs`)
- Source: `deploy/railway/seaweedfs/Dockerfile` + `entrypoint.sh`.
- Attach a Railway **volume at `/data`** (metadata only — modest size, e.g. ≥10 GB).
- Env:
  | Var | Value | Purpose |
  |---|---|---|
  | `ONPREM_S3_ACCESS_KEY` / `ONPREM_S3_SECRET_KEY` | strong creds | entrypoint renders `/data/s3.json`; refuses demo creds |
  | `SEAWEED_VOLUME_SIZE_LIMIT_MB` | `5000` | 5 GB volumes ⇒ even spread across vol servers |
  | `GOMEMLIMIT` | `18GiB` | Go heap soft-cap (leaves headroom under the 24 GB box) |
  | `GOGC` | `50` | collect sooner |

### 3.2 Volume servers (`seaweedfs-vol-1..N`)
- Source: same repo, **`RAILWAY_DOCKERFILE_PATH=deploy/railway/seaweedfs-volume/Dockerfile`**.
- Attach a Railway **volume at `/data`** to **each** (size ≈ `total_data ÷ N + headroom`; currently 73 GB each).
- Env on each:
  | Var | Value | Purpose |
  |---|---|---|
  | `SEAWEED_MASTER` | `seaweedfs.railway.internal:9333` | which master to register with |
  | `SEAWEED_VOLUME_MAX` | `100` | max volumes the server may host (disk is the real limit) |
  | `RAILWAY_DOCKERFILE_PATH` | `deploy/railway/seaweedfs-volume/Dockerfile` | build the volume image |

  > **Attach volumes via the API, not the dashboard "+Volume" button.** A
  > dashboard-created volume can land **unbound** (`Attached to: N/A`). Use
  > `volumeCreate(projectId, environmentId, serviceId, mountPath:"/data")` so it
  > binds to the service, then **redeploy** the service so it mounts.

### 3.3 Verify it actually shards (do this before trusting a backup)
- Coordinator logs show all servers registered:
  `added volume server seaweedfs-vol-N.railway.internal:8080`.
- From a worker, the master distributes assigns across servers and **never the coordinator**:
  ```
  railway ssh -s backup_worker "for i in $(seq 8); do curl -s http://seaweedfs.railway.internal:9333/dir/assign; echo; done"
  # expect seaweedfs-vol-* in the urls, spread across servers
  ```
- End-to-end write: `assign → PUT to the returned url/fid → GET it back`.
- Each vol server `/data` is writable (`railway ssh -s seaweedfs-vol-1 "df -h /data"` shows the mounted volume + space).

---

## 4. Config reference (deployed values)

### 4.1 SeaweedFS cluster
| Var | Where | Default | **Deployed** | Notes |
|---|---|---|---|---|
| `SEAWEED_MASTER` | vol-server entrypoint | — (required) | `seaweedfs.railway.internal:9333` | master address the vol server registers with |
| `SEAWEED_VOLUME_MAX` | vol-server entrypoint | `100` | `100` | max volumes per server; disk is the real cap |
| `SEAWEED_VOLUME_SIZE_LIMIT_MB` | coordinator entrypoint | `30000` | `5000` | per-volume rollover; 5 GB ⇒ even cross-server spread |
| `SEAWEED_ADVERTISE_IP` | vol-server entrypoint | `RAILWAY_PRIVATE_DOMAIN` | (auto) | advertised host; binds 0.0.0.0 internally |
| `SEAWEED_VOLUME_PORT` | vol-server entrypoint | `8080` | `8080` | volume HTTP port (gRPC = +10000 = 18080) |
| `GOMEMLIMIT` | coordinator + vol servers | — | `18GiB` | Go runtime heap soft-cap |
| `GOGC` | coordinator + vol servers | `100` | `50` | GC aggressiveness |

> **Bind fix (load-bearing):** the volume entrypoint passes `-ip.bind=0.0.0.0`.
> Without it the gRPC port (18080) tries to bind the advertised IP — which isn't
> on a local interface on Railway — and the server **crash-loops** with
> `bind: cannot assign requested address`.

### 4.2 S3 client timeouts (worker → SeaweedFS) — `shared/storage/seaweedfs.py`
Bounded so a slow/restarting server **fails fast → per-file retry queue** instead of hanging the drain coroutine (which would hold the partition lease and stall the snapshot forever).
| Var | Default | Purpose |
|---|---|---|
| `ONPREM_S3_CONNECT_TIMEOUT_S` | `10` | fail fast if a vol server is unreachable |
| `ONPREM_S3_READ_TIMEOUT_S` | `120` | per-request read timeout |
| `ONPREM_S3_MAX_ATTEMPTS` | `3` | botocore retry attempts |
| `ONPREM_S3_MAX_POOL` | `256` | connection pool (default 10 would stall at high file-concurrency) |

### 4.3 Max-performance worker concurrency (heavy worker — current)
The seaweed sink is sharded (no longer the bottleneck), so these are set high:
| Var | Default | **Deployed** |
|---|---|---|
| `ONEDRIVE_BACKUP_FILE_CONCURRENCY` | `16` | **`128`** |
| `ONEDRIVE_PREFETCH_CONCURRENCY` | — | **`96`** |
| `ONPREM_UPLOAD_CONCURRENCY` | `16` | **`96`** |
| `ONEDRIVE_LARGE_FILE_SEGMENT_CONCURRENCY` | `8` | **`32`** |
| `ONEDRIVE_HUGE_FILE_RAM_BUDGET_GIB` | `4` | **`16`** (caps in-flight huge-file RAM ⇒ download backpressures on write) |
| `ONEDRIVE_PARTITION_MAX_SHARDS` | `4` | **`16`** (= heavy worker count) |

---

## 5. Operational notes

- **No dirty-page OOM** as long as writes spread across the vol servers. The
  master self-balances by free space (5 GB volumes rotate to the emptiest
  server). Watch for one server taking a disproportionate share on the first
  run; if it does, it's a balance issue, not a memory limit.
- **Capacity, not RAM, is the mass-backup ceiling.** Total = `N × per-vol-disk`
  (currently 4 × 73 = 292 GB). A mass backup exceeding that fills disks
  (`volume … is read only`). For TB-scale, bump vol disks or add vol servers —
  adding a server is just another `seaweedfs-vol-N` with `SEAWEED_MASTER` set.
- **Backpressure chain:** worker `HUGE_FILE_RAM_BUDGET_GIB` (caps in-flight) →
  `ONPREM_UPLOAD_CONCURRENCY` → S3 timeouts → 4× disk flush. The download can't
  outrun the disk into an OOM.
- **UI progress lag:** `snapshots.bytes_total` only rolls up at
  partition-finalize, so a 126 GB OneDrive can show ~6 GB mid-run then jump at
  the end. The **source of truth is `snapshot_items` (sum of `content_size`)**,
  not `bytes_total`.
- **Throughput:** ~1.5 Gbps per large OneDrive in a shared mass run. Sharding
  removed the *sink* bottleneck; the ceiling is now download/worker count — to
  go higher, add heavy workers, not seaweed nodes.

---

## 6. File map

| Path | Role |
|---|---|
| `deploy/railway/seaweedfs/Dockerfile` + `entrypoint.sh` | Coordinator (master+filer+s3, volume-less) |
| `deploy/railway/seaweedfs-volume/Dockerfile` + `entrypoint.sh` | Volume-server image (`weed volume`, `-ip.bind=0.0.0.0`) |
| `shared/storage/seaweedfs.py` | `SeaweedStore` S3 client + the bounded timeout config |
| `shared/storage/router.py` | Routes writes to the active backend (`seaweedfs-local`) |
