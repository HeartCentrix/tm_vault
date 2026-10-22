import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { getActivities, downloadActivityCSV, cancelJob, retryIncompleteResources, type ActivityItem as ActivityItemType, type ActivityListParams } from '../services/activity';
import { getAudits, getAuditDetails, getRiskSignals, downloadAuditCSV, type AuditItem as AuditItemType, type AuditListParams, type AuditDetailsResponse, type RiskSignalItem, type RiskSignalParams } from '../services/audit';
import { usePersistentTab } from '../hooks/usePersistentTab';
import { fmtLocal } from '../utils/datetime';
import { API } from '../config/api';
import { ActivityRow } from '../components/ActivityRow';
import './Activity.css';

type ViewType = 'tasks' | 'audit' | 'risk';

// Single source of truth for the Operation filter. DISCOVERY was missing
// from the hard-coded <option> list while the feed emitted 37 DISCOVERY rows
// per 200 and the API accepted `operation=DISCOVERY`, so discovery runs could
// be neither isolated nor excluded (BUG-003). Any operation the API can
// return must appear here — that is the whole point of the list existing
// once instead of being retyped inline.
const ACTIVITY_OPERATIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'BACKUP', label: 'Backup' },
  { value: 'RESTORE', label: 'Restore' },
  { value: 'EXPORT', label: 'Export' },
  { value: 'DISCOVERY', label: 'Discovery' },
];

export default function Activity() {
  const { tenantId: routeTenantId, serviceType: routeServiceType } = useParams<{ tenantId?: string; serviceType?: string }>();
  const viewTabKeys = ['tasks', 'audit', 'risk'] as const;
  const [viewType, setViewType] = usePersistentTab<ViewType>('/activity', 'tasks', viewTabKeys);

  // Date filters
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  // An inverted range is a user error, not an empty result set (BUG-006).
  // ISO yyyy-mm-dd compares correctly as a string, which is why the native
  // input's value format is used directly.
  const dateRangeInvalid = Boolean(startDate && endDate && startDate > endDate);

  // Task filters
  const [taskOperation, setTaskOperation] = useState('');
  const [taskStatus, setTaskStatus] = useState('');

  // Audit filters
  const [auditActorType, setAuditActorType] = useState('');
  const [auditAction, setAuditAction] = useState('');

  // Risk filters
  const [riskLevel, setRiskLevel] = useState('');
  const [minRiskScore] = useState(20);
  // Real sort state for the Risk tab, sent to the server so ordering and
  // pagination agree. Client-side sorting would only reorder the 50 rows of
  // the current page out of 174 — a different bug wearing the same clothes.
  const [riskSort, setRiskSort] = useState<'date' | 'risk_score'>('date');
  const [riskOrder, setRiskOrder] = useState<'asc' | 'desc'>('desc');
  const toggleRiskSort = (col: 'date' | 'risk_score') => {
    if (riskSort === col) {
      setRiskOrder(o => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setRiskSort(col);
      setRiskOrder('desc');
    }
    setRiskPage(1);
  };

  // Data
  const [activities, setActivities] = useState<ActivityItemType[]>([]);
  const [audits, setAudits] = useState<AuditItemType[]>([]);
  const [riskSignals, setRiskSignals] = useState<RiskSignalItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Pagination
  const [taskPage, setTaskPage] = useState(1);
  const [auditPage, setAuditPage] = useState(1);
  const [riskPage, setRiskPage] = useState(1);
  const [taskTotal, setTaskTotal] = useState(0);
  const [auditTotal, setAuditTotal] = useState(0);
  const [riskTotal, setRiskTotal] = useState(0);
  const pageSize = 50;
  // Server-reported "another page exists". Authoritative for enabling Next:
  // a `total` we don't trust must never be able to hide history (BUG-001 —
  // the endpoint reported rows-fetched, so Next died at page 2 of ~6).
  const [taskHasMore, setTaskHasMore] = useState(false);

  // ── Request coordination (BUG-004 / BUG-005) ─────────────────────────
  // The 8s silent poll used to be built from the closure it was created in,
  // so the tick fired immediately after a filter change went out WITHOUT the
  // new params and repainted the grid with unfiltered rows. Filters live in
  // a ref so the poll always reads current state, and every request carries
  // a generation number so a slow earlier response can never land last.
  const filtersRef = useRef({ startDate: '', endDate: '', taskOperation: '', taskStatus: '', taskPage: 1 });
  useEffect(() => {
    filtersRef.current = { startDate, endDate, taskOperation, taskStatus, taskPage };
  }, [startDate, endDate, taskOperation, taskStatus, taskPage]);
  const reqGenRef = useRef(0);
  const inFlightRef = useRef<AbortController | null>(null);

  // Modal
  const [selectedAudit, setSelectedAudit] = useState<AuditDetailsResponse | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [rawDetails, setRawDetails] = useState<Record<string, any> | null>(null);
  const [showRawModal, setShowRawModal] = useState(false);

  // Tracks job IDs we're awaiting a cancel response for, so the cross button
  // disables itself between click and the optimistic local status flip.
  const [cancellingJobs, setCancellingJobs] = useState<Set<string>>(new Set());
  // Rows with a retry dispatch in flight, so the button can disable and
  // spin without blocking the rest of the table.
  const [retryingRows, setRetryingRows] = useState<Set<string>>(new Set());
  const [retryNotice, setRetryNotice] = useState<string | null>(null);

  // Sort
  const [sortColumn, setSortColumn] = useState<string>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Download state
  const [downloading, setDownloading] = useState(false);

  // Monotonic progress clamp — keyed by batchId (or job id for legacy
  // rows). Server-supplied progress can dip momentarily across polls
  // (e.g. after a finalize reconcile); we expose only the running max
  // so the bar never visibly retreats.
  //
  // Null/undefined progress is meaningful: it means the server has no
  // estimate yet (bytes_expected was null at batch creation, common
  // for first-ever backups). Return null in that case so the renderer
  // can show "—" instead of a stale ratcheted value. Without this
  // guard, a prior poll's 99% was getting cached and shown as the
  // "current" progress even after the server stopped reporting,
  // producing the 2026-05-15 incident where the card said 100% but
  // the actual snapshot was incomplete.
  //
  // Field-name compatibility: the new backup_batches-driven Activity
  // rows use `progressPct` (Task 7 of the batch-race-fix spec); the
  // legacy _group_batch_jobs path used `progress_pct`. Prefer the
  // new field when both are present.
  const progressClampRef = useRef<Map<string, number>>(new Map());
  const clampProgress = (item: ActivityItemType): number | null => {
    const key = item.batchId || item.id;
    const server = item.progressPct ?? item.progress_pct;
    if (server == null) {
      // No server-supplied progress this poll. Don't ratchet 0 in:
      // that's what produced stale-100% renders. Return null so the
      // renderer shows "—".
      return null;
    }
    const prev = progressClampRef.current.get(key) ?? 0;
    const next = Math.max(prev, server);
    if (next !== prev) progressClampRef.current.set(key, next);
    return next;
  };

  const selectedSourceRaw = localStorage.getItem('selected_datasource');
  let selectedSourceTenantId: string | undefined;
  let selectedSourceType: 'm365' | 'azure' | undefined;
  if (selectedSourceRaw) {
    try {
      const parsed = JSON.parse(selectedSourceRaw) as { id?: string; type?: string } | null;
      selectedSourceTenantId = parsed?.id;
      if (parsed?.type === 'm365' || parsed?.type === 'azure') {
        selectedSourceType = parsed.type;
      }
    } catch {
      // ignore malformed persisted value
    }
  }

  // Activity is intentionally tenant-agnostic — a single global feed
  // across every tenant the user can see. Route params + persisted
  // source are ignored so jobs/audit/risk rows don't disappear just
  // because the user is browsing a different tenant's Protection page.
  const effectiveTenantId: string | undefined = undefined;
  const effectiveServiceType: 'm365' | 'azure' | undefined = undefined;
  // Reference the would-be params so TS doesn't complain about unused
  // vars, and keep the lookups intact for any future per-tenant toggle.
  void routeTenantId; void routeServiceType; void selectedSourceTenantId; void selectedSourceType;

  useEffect(() => {
    fetchData();
  }, [viewType, startDate, endDate, taskOperation, taskStatus, auditActorType, auditAction, riskLevel, taskPage, auditPage, riskPage, riskSort, riskOrder]);

  // Silent polling — every 8s while the current list contains any
  // in-flight backup/restore (In Progress). Auto-stops the moment every
  // row settles on a terminal state, so the browser isn't hammering the
  // endpoint 24/7. Keyed to `activities` so it re-arms whenever the
  // list changes. The tick uses a direct fetch with `_silent=1` so the
  // gateway's uvicorn access-log filter suppresses the noise.
  useEffect(() => {
    if (viewType !== 'tasks') return;
    const anyLive = activities.some(a => a.status === 'In Progress');
    if (!anyLive) return;
    const t = setInterval(async () => {
      // Read filters from the ref, never from this closure — the effect is
      // keyed on `activities`, so its closure is stale the instant a filter
      // changes (BUG-004: start_date was dropped from the very next tick).
      const f = filtersRef.current;
      const gen = ++reqGenRef.current;
      try {
        const params = new URLSearchParams({
          page: String(f.taskPage), size: String(pageSize), _silent: '1',
        });
        if (f.startDate) params.set('start_date', f.startDate);
        if (f.endDate) params.set('end_date', f.endDate);
        if (f.taskOperation) params.set('operation', f.taskOperation);
        if (f.taskStatus) params.set('status', f.taskStatus);
        const res = await fetch(`${API.ACTIVITY.LIST}?${params}`);
        if (!res.ok) return;
        const data = await res.json();
        // Someone (a filter change, a page change, another poll) issued a
        // newer request while this one was in flight — drop it. Correct
        // params alone don't fix the race; a slow early response can still
        // land last and repaint the grid with results nobody asked for.
        if (gen !== reqGenRef.current) return;
        setActivities(data.items || []);
        if (typeof data.total === 'number') setTaskTotal(data.total);
        setTaskHasMore(Boolean(data.has_more));
      } catch { /* ignore transient errors */ }
    }, 8000);
    return () => clearInterval(t);
    // No exhaustive-deps suppression needed any more: the filters this
    // callback used to close over now come from filtersRef, so [activities,
    // viewType] really is the complete dependency list. The suppression was
    // hiding the stale closure, not tolerating it.
  }, [activities, viewType]);

  const fetchData = useCallback(async () => {
    // An inverted range can only ever return nothing, and "No activities
    // found" reads as "there was no backup activity" — a dangerous
    // misreading in an audit tool. Don't issue the request at all (BUG-006).
    if (dateRangeInvalid) {
      setActivities([]); setAudits([]); setRiskSignals([]);
      setTaskTotal(0); setAuditTotal(0); setRiskTotal(0);
      setTaskHasMore(false);
      setLoading(false);
      return;
    }
    // Supersede any request still in flight rather than racing it (BUG-005).
    inFlightRef.current?.abort();
    const ctl = new AbortController();
    inFlightRef.current = ctl;
    const gen = ++reqGenRef.current;
    setLoading(true);
    try {
      if (viewType === 'tasks') {
        const params: ActivityListParams = {
          tenantId: effectiveTenantId,
          serviceType: effectiveServiceType,
          startDate,
          endDate,
          operation: taskOperation || undefined,
          status: taskStatus || undefined,
          page: taskPage,
          size: pageSize,
        };
        const response = await getActivities(params, ctl.signal);
        if (gen !== reqGenRef.current) return;
        setActivities(response.items);
        setTaskTotal(response.total);
        setTaskHasMore(response.has_more);
      } else if (viewType === 'audit') {
        const params: AuditListParams = {
          startDate,
          endDate,
          actorType: auditActorType || undefined,
          action: auditAction || undefined,
          page: auditPage,
          size: pageSize,
        };
        const response = await getAudits(params);
        setAudits(response.items);
        setAuditTotal(response.total);
      } else {
        const params: RiskSignalParams = {
          startDate,
          endDate,
          riskLevel: riskLevel || undefined,
          minRiskScore,
          page: riskPage,
          size: pageSize,
          sort: riskSort,
          order: riskOrder,
        };
        const response = await getRiskSignals(params);
        setRiskSignals(response.items);
        setRiskTotal(response.total);
      }
    } catch (error) {
      // An abort is us superseding our own request, not a failure.
      if ((error as { name?: string })?.name === 'AbortError') return;
      console.error('Failed to fetch data:', error);
    } finally {
      if (gen === reqGenRef.current) setLoading(false);
    }
  }, [viewType, startDate, endDate, taskOperation, taskStatus, auditActorType, auditAction, riskLevel, taskPage, auditPage, riskPage, minRiskScore, effectiveTenantId, effectiveServiceType, dateRangeInvalid, riskSort, riskOrder]);

  // Drop any in-flight request when the page unmounts so its response can't
  // resolve into a dead component.
  useEffect(() => () => { inFlightRef.current?.abort(); }, []);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const params: Record<string, string> = {};
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;

      if (viewType === 'tasks') {
        if (effectiveTenantId) params.tenantId = effectiveTenantId;
        if (effectiveServiceType) params.serviceType = effectiveServiceType;
        if (taskOperation) params.operation = taskOperation;
        if (taskStatus) params.status = taskStatus;
        const blob = await downloadActivityCSV(params);
        triggerDownload(blob, 'activities.csv');
      } else {
        if (auditActorType) params.actorType = auditActorType;
        if (auditAction) params.action = auditAction;
        const blob = await downloadAuditCSV(params);
        triggerDownload(blob, 'audit-log.csv');
      }
    } catch (error) {
      console.error('Failed to download:', error);
    } finally {
      setDownloading(false);
    }
  };

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleAuditClick = async (audit: AuditItemType) => {
    try {
      const details = await getAuditDetails(audit.id);
      setSelectedAudit(details);
      setShowModal(true);
    } catch (error) {
      console.error('Failed to fetch audit details:', error);
    }
  };

  const handleViewRawDetails = (item: AuditItemType | RiskSignalItem) => {
    if (item.details) {
      try {
        setRawDetails(JSON.parse(item.details));
      } catch {
        setRawDetails({ raw: item.details });
      }
      setShowRawModal(true);
    }
  };

  const closeModal = () => {
    setShowModal(false);
    setSelectedAudit(null);
  };

  const closeRawModal = () => {
    setShowRawModal(false);
    setRawDetails(null);
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '—';
    return fmtLocal(dateString, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  };

  // Re-run only the resources in this run that did not complete.
  //
  // Deliberately does NOT change this row's status. The row is a record
  // of what happened; the re-run is new work and appears as its own
  // Activity entry on the next poll. Overwriting the historical status
  // is what produced rows stuck reading "In Progress" forever.
  const handleRetryRow = async (item: ActivityItemType) => {
    if (retryingRows.has(item.id)) return;
    if (!item.batchId) {
      // Single-resource row (auto-retry / manual trigger): re-dispatch via
      // the job — the server resolves the resource and runs the same
      // trigger-user path. The old server endpoint only flipped the row to
      // QUEUED and published nothing, which is why this button "did not
      // work" for these rows (fixed 2026-08-18).
      const jobId = item.jobIds && item.jobIds[0];
      if (!jobId) return;
      setRetryingRows(prev => new Set(prev).add(item.id));
      setRetryNotice(null);
      try {
        const res = await fetch(API.JOBS.RETRY(jobId), { method: 'POST' });
        if (res.ok) {
          setRetryNotice('Re-running 1 resource — it will appear as new activity.');
        } else {
          const body = await res.text();
          setRetryNotice(`Retry failed (${res.status}): ${body.slice(0, 160)}`);
        }
      } catch (e) {
        console.error('Retry failed:', e);
        setRetryNotice('Retry failed — see console for detail.');
      } finally {
        setRetryingRows(prev => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
      }
      return;
    }
    setRetryingRows(prev => new Set(prev).add(item.id));
    setRetryNotice(null);
    try {
      const { dispatched, failed, remaining } = await retryIncompleteResources(item.batchId);
      // "N still to go" is the important half: the cap means one click
      // does NOT necessarily retry everything, and silently doing less
      // than the operator expects is worse than doing it slowly.
      const more = remaining > 0
        ? ` ${remaining} more still incomplete — click Retry again when these finish.`
        : '';
      if (dispatched.length === 0 && failed.length === 0) {
        setRetryNotice('Nothing to retry — no incomplete resources in that run.');
      } else if (failed.length > 0) {
        setRetryNotice(
          `Re-ran ${dispatched.length} of ${dispatched.length + failed.length} resource(s); ` +
          `${failed.length} could not be dispatched.${more}`
        );
      } else {
        setRetryNotice(
          `Re-running ${dispatched.length} resource(s) — they will appear as new activity.${more}`
        );
      }
    } catch (e) {
      console.error('Retry failed:', e);
      setRetryNotice('Retry failed — see console for detail.');
    } finally {
      setRetryingRows(prev => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const handleCancelJob = async (rowId: string, jobIds?: string[]) => {
    if (cancellingJobs.has(rowId)) return;
    setCancellingJobs(prev => new Set(prev).add(rowId));
    // Batch rows surface multiple underlying Job IDs; iterate so every
    // partitioned worker-pool slice gets cancelled by one click.
    const targets = jobIds && jobIds.length > 0 ? jobIds : [rowId];
    try {
      await Promise.all(targets.map(id => cancelJob(id)));
      setActivities(prev => prev.map(a => a.id === rowId ? { ...a, status: 'Canceled' } : a));
    } catch (e) {
      console.error('Failed to cancel job:', e);
      setCancellingJobs(prev => {
        const next = new Set(prev);
        next.delete(rowId);
        return next;
      });
    }
  };

  const getStatusIcon = (status: string, jobId?: string, jobIds?: string[]) => {
    switch (status) {
      case 'Done':
        return (
          <span className="status-badge status-done">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Done
          </span>
        );
      case 'In Progress':
        return (
          <span className="status-badge status-in-progress">
            <span className="spinner-small" />
            In Progress
            {jobId && (
              <button
                type="button"
                className="status-badge-cancel"
                title="Cancel job"
                aria-label="Cancel job"
                disabled={cancellingJobs.has(jobId)}
                onClick={(e) => { e.stopPropagation(); handleCancelJob(jobId, jobIds); }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </span>
        );
      case 'Failed':
        return (
          <span className="status-badge status-failed">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            Failed
          </span>
        );
      case 'Warning':
        return (
          <span className="status-badge status-warning">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18A2 2 0 0 0 3.53 21h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Warning
          </span>
        );
      case 'Canceled':
        return (
          <span className="status-badge status-canceled">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            Canceled
          </span>
        );
      case 'Expired':
        // The backup completed, but its restore point later aged out under the
        // SLA retention policy. Neutral (not error) styling — reuses the muted
        // canceled treatment. This is what the older same-day GFS fires show
        // once retention prunes them; it must never read as "Failed".
        return (
          <span className="status-badge status-canceled" title="Backup completed; restore point aged out under retention policy">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 7 12 12 15 14" />
            </svg>
            Expired
          </span>
        );
      default:
        return <span className="status-badge">{status}</span>;
    }
  };

  const getRiskBadge = (level: string, score: number) => {
    const className = `risk-badge risk-${level.toLowerCase()}`;
    return (
      <span className={className}>
        {level} ({score})
      </span>
    );
  };

  const resetFilters = () => {
    setStartDate('');
    setEndDate('');
    setTaskOperation('');
    setTaskStatus('');
    setAuditActorType('');
    setAuditAction('');
    setRiskLevel('');
    setTaskPage(1);
    setAuditPage(1);
    setRiskPage(1);
  };

  const totalItems = viewType === 'tasks' ? taskTotal : viewType === 'audit' ? auditTotal : riskTotal;
  const currentPage = viewType === 'tasks' ? taskPage : viewType === 'audit' ? auditPage : riskPage;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  // Rows actually on screen. The footer range is derived from THIS, never
  // from `total` — the old `Math.min(page*size, total)` printed
  // "Showing 51–93 of 93" over 50 rendered rows (BUG-002).
  const renderedCount = viewType === 'tasks'
    ? activities.length
    : viewType === 'audit' ? audits.length : riskSignals.length;
  const rangeFrom = (currentPage - 1) * pageSize + 1;
  const rangeTo = rangeFrom + renderedCount - 1;
  // A `total` smaller than what we're showing is self-evidently wrong; say
  // the honest half rather than printing a contradiction.
  const totalTrustworthy = totalItems >= rangeTo;
  // Next is driven by the server's has_more where we have it, so an
  // untrustworthy total degrades into "one more click" instead of silently
  // amputating history (BUG-001).
  const canGoNext = viewType === 'tasks'
    ? (taskHasMore || currentPage < totalPages)
    : currentPage < totalPages;

  // Clamp page back if totals shrunk (e.g. filter change left us past the last page)
  useEffect(() => {
    if (totalItems === 0) return;
    // Never clamp against a total we've already caught lying, and never
    // clamp away a page the server says has more after it — that is the
    // exact path by which a bad total amputated two thirds of the history.
    if (!totalTrustworthy || canGoNext) return;
    const max = Math.max(1, totalPages);
    if (viewType === 'tasks' && taskPage > max) setTaskPage(max);
    else if (viewType === 'audit' && auditPage > max) setAuditPage(max);
    else if (viewType === 'risk' && riskPage > max) setRiskPage(max);
  }, [viewType, totalPages, totalItems, taskPage, auditPage, riskPage, totalTrustworthy, canGoNext]);

  return (
    <div className="activity-page">
      <div className="activity-header">
        <h2 className="page-title">Activity & Audit</h2>
        <div className="header-controls">
          <div className="date-filters">
            <div className="date-input-group">
              <label htmlFor="activity-start-date">Start date</label>
              <input
                id="activity-start-date"
                type="date"
                value={startDate}
                max={endDate || undefined}
                aria-invalid={dateRangeInvalid || undefined}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="date-input-group">
              <label htmlFor="activity-end-date">End date</label>
              <input
                id="activity-end-date"
                type="date"
                value={endDate}
                min={startDate || undefined}
                aria-invalid={dateRangeInvalid || undefined}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            {dateRangeInvalid && (
              <p className="date-range-error" role="alert">
                End date must be on or after the start date.
              </p>
            )}
          </div>

          {/* Tab-specific filters */}
          {viewType === 'tasks' && (
            <div className="inline-filters">
              <select value={taskOperation} onChange={(e) => { setTaskOperation(e.target.value); setTaskPage(1); }}>
                <option value="">All Operations</option>
                {ACTIVITY_OPERATIONS.map(op => (
                  <option key={op.value} value={op.value}>{op.label}</option>
                ))}
              </select>
              <select value={taskStatus} onChange={(e) => { setTaskStatus(e.target.value); setTaskPage(1); }}>
                <option value="">All Statuses</option>
                <option value="Done">Done</option>
                <option value="In Progress">In Progress</option>
                <option value="Warning">Warning</option>
                <option value="Failed">Failed</option>
                <option value="Canceled">Canceled</option>
              </select>
            </div>
          )}

          {viewType === 'audit' && (
            <div className="inline-filters">
              <select value={auditActorType} onChange={(e) => { setAuditActorType(e.target.value); setAuditPage(1); }}>
                <option value="">All Actors</option>
                <option value="USER">User</option>
                <option value="SYSTEM">System</option>
                <option value="WORKER">Worker</option>
              </select>
              <select value={auditAction} onChange={(e) => { setAuditAction(e.target.value); setAuditPage(1); }}>
                <option value="">All Actions</option>
                <option value="BACKUP_COMPLETED">Backup Completed</option>
                <option value="BACKUP_FAILED">Backup Failed</option>
                <option value="RESTORE_COMPLETED">Restore Completed</option>
                <option value="SLA_UPDATED">SLA Updated</option>
                <option value="LOGIN_SUCCESS">Login Success</option>
                <option value="LOGIN_FAILED">Login Failed</option>
                <option value="GRAPH_DIRECTORY">Graph Directory</option>
                <option value="GRAPH_SIGNIN">Graph Sign-In</option>
                <option value="RANSOMWARE_SIGNAL">Ransomware Signal</option>
              </select>
            </div>
          )}

          {viewType === 'risk' && (
            <div className="inline-filters">
              <select value={riskLevel} onChange={(e) => { setRiskLevel(e.target.value); setRiskPage(1); }}>
                <option value="">All Risk Levels</option>
                <option value="CRITICAL">Critical</option>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
              </select>
            </div>
          )}

          <button className="reset-btn" onClick={resetFilters} title="Reset all filters">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}>
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
            Reset
          </button>

          <button className="download-btn" onClick={handleDownload} disabled={downloading || totalItems === 0}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {downloading ? 'Downloading...' : 'Download'}
          </button>

          <div className="view-toggle">
            <button
              className={`toggle-btn ${viewType === 'tasks' ? 'active' : ''}`}
              onClick={() => setViewType('tasks')}
            >
              Tasks
            </button>
            <button
              className={`toggle-btn ${viewType === 'audit' ? 'active' : ''}`}
              onClick={() => setViewType('audit')}
            >
              Audit
            </button>
            <button
              className={`toggle-btn ${viewType === 'risk' ? 'active' : ''}`}
              onClick={() => setViewType('risk')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14, marginRight: 4 }}>
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              Risk
            </button>
          </div>
        </div>

        {/* Pagination controls */}
        {totalItems > 0 && (
          <div className="pagination-bar">
            <span className="pagination-info">
              {loading
                ? 'Loading…'
                : totalTrustworthy
                  ? `Showing ${rangeFrom}–${rangeTo} of ${totalItems}`
                  : `Showing ${rangeFrom}–${rangeTo}`}
            </span>
            <div className="pagination-buttons">
              <button
                disabled={currentPage <= 1}
                onClick={() => {
                  const prev = (p: number) => Math.max(1, p - 1);
                  if (viewType === 'tasks') setTaskPage(prev);
                  else if (viewType === 'audit') setAuditPage(prev);
                  else setRiskPage(prev);
                }}
              >
                &laquo; Prev
              </button>
              <span className="page-number">
                {totalTrustworthy ? `${currentPage} / ${totalPages}` : `${currentPage}`}
              </span>
              <button
                disabled={!canGoNext}
                onClick={() => {
                  const max = canGoNext ? currentPage + 1 : Math.max(1, totalPages);
                  const next = (p: number) => Math.min(max, p + 1);
                  if (viewType === 'tasks') setTaskPage(next);
                  else if (viewType === 'audit') setAuditPage(next);
                  else setRiskPage(next);
                }}
              >
                Next &raquo;
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="activity-table-container">
        {/* Result of the last Retry click. Dismissible, and never blocks
            the table — the re-run itself shows up as new activity rows. */}
        {retryNotice && viewType === 'tasks' && (
          <div className="retry-notice" role="status">
            <span>{retryNotice}</span>
            <button
              type="button"
              className="retry-notice-dismiss"
              aria-label="Dismiss"
              onClick={() => setRetryNotice(null)}
            >
              ×
            </button>
          </div>
        )}
        {/* ==================== TASKS TAB ==================== */}
        {viewType === 'tasks' && (
          <table className="activity-table">
            <thead>
              <tr>
                <th className="sortable" onClick={() => { setSortColumn('start'); setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc'); }}>
                  Start {sortColumn === 'start' && <span className="sort-indicator">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                </th>
                <th className="sortable" onClick={() => { setSortColumn('operation'); setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc'); }}>
                  Operation {sortColumn === 'operation' && <span className="sort-indicator">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                </th>
                <th>Object</th>
                <th className="sortable" onClick={() => { setSortColumn('status'); setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc'); }}>
                  Status {sortColumn === 'status' && <span className="sort-indicator">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                </th>
                <th>Finish</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="loading-cell"><div className="loading-spinner" /></td></tr>
              ) : activities.length === 0 ? (
                <tr><td colSpan={6} className="empty-cell">No activities found</td></tr>
              ) : (
                activities.map((activity) => (
                  <ActivityRow
                    key={activity.id}
                    item={activity}
                    displayedProgressPct={clampProgress(activity)}
                    renderStatusIcon={getStatusIcon}
                    formatDate={formatDate}
                    onRetry={handleRetryRow}
                    retrying={retryingRows.has(activity.id)}
                  />
                ))
              )}
            </tbody>
          </table>
        )}

        {/* ==================== AUDIT TAB ==================== */}
        {viewType === 'audit' && (
          <table className="audit-table">
            <thead>
              <tr>
                <th className="sortable" onClick={() => { setSortColumn('date'); setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc'); }}>
                  Date {sortColumn === 'date' && <span className="sort-indicator">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                </th>
                <th>Actor</th>
                <th className="sortable" onClick={() => { setSortColumn('operation'); setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc'); }}>
                  Operation {sortColumn === 'operation' && <span className="sort-indicator">{sortDirection === 'asc' ? '↑' : '↓'}</span>}
                </th>
                <th>Object</th>
                <th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="loading-cell"><div className="loading-spinner" /></td></tr>
              ) : audits.length === 0 ? (
                <tr><td colSpan={5} className="empty-cell">No audit logs found</td></tr>
              ) : (
                audits.map((audit) => (
                  <tr key={audit.id} onClick={() => handleAuditClick(audit)} className="clickable-row">
                    <td>{formatDate(audit.date)}</td>
                    <td className="actor-cell">
                      <span className="actor-type">{audit.actor}</span>
                      {audit.actor_email && <span className="actor-email">{audit.actor_email}</span>}
                    </td>
                    <td><span className="operation-badge">{audit.operation}</span></td>
                    <td className="object-cell">{audit.object}</td>
                    <td className="risk-cell">
                      {audit.risk_signals ? (
                        <span onClick={(e) => { e.stopPropagation(); handleViewRawDetails(audit); }}>
                          {getRiskBadge(audit.risk_level || 'MEDIUM', audit.risk_score || 0)}
                        </span>
                      ) : (
                        <span className="risk-none">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}

        {/* ==================== RISK SIGNALS TAB ==================== */}
        {viewType === 'risk' && (
          <table className="risk-table">
            <thead>
              <tr>
                {/* Sortable headers are real buttons driven by the server's
                    sort state. Previously DATE always painted an indicator
                    and clicking it only flipped the arrow — the rows never
                    moved because the server sorted the page by risk score
                    after cutting it by date (BUG-009). */}
                <th aria-sort={riskSort === 'date' ? (riskOrder === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" className="th-sort" onClick={() => toggleRiskSort('date')}>
                    Date {riskSort === 'date' && <span className="sort-indicator" aria-hidden="true">{riskOrder === 'asc' ? '↑' : '↓'}</span>}
                  </button>
                </th>
                <th>Risk Level</th>
                <th aria-sort={riskSort === 'risk_score' ? (riskOrder === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" className="th-sort" onClick={() => toggleRiskSort('risk_score')}>
                    Risk Score {riskSort === 'risk_score' && <span className="sort-indicator" aria-hidden="true">{riskOrder === 'asc' ? '↑' : '↓'}</span>}
                  </button>
                </th>
                <th>Actor</th>
                <th>Operation</th>
                <th>Object</th>
                <th>Signals</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="loading-cell"><div className="loading-spinner" /></td></tr>
              ) : riskSignals.length === 0 ? (
                <tr><td colSpan={7} className="empty-cell">No risk signals detected</td></tr>
              ) : (
                riskSignals.map((signal) => (
                  <tr key={signal.id} onClick={() => handleAuditClick(signal)} className="clickable-row">
                    <td>{formatDate(signal.date)}</td>
                    <td>{getRiskBadge(signal.risk_level, signal.risk_score)}</td>
                    <td>
                      <div className="risk-score-bar">
                        <div className="risk-score-fill" style={{ width: `${signal.risk_score}%` }} />
                      </div>
                      <span className="risk-score-text">{signal.risk_score}/100</span>
                    </td>
                    <td className="actor-cell">
                      <span className="actor-type">{signal.actor}</span>
                      {signal.actor_email && <span className="actor-email">{signal.actor_email}</span>}
                    </td>
                    <td><span className="operation-badge">{signal.operation}</span></td>
                    <td className="object-cell">{signal.object}</td>
                    <td className="signals-cell">
                      {Object.keys(signal.risk_signals).filter(k => !['risk_level', 'risk_score', 'investigation_urgency'].includes(k)).map(key => (
                        <span key={key} className="signal-tag">{key.replace(/_/g, ' ')}</span>
                      ))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* ==================== AUDIT DETAIL MODAL ==================== */}
      {showModal && selectedAudit && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="audit-modal-compact" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-x" onClick={closeModal}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <div className="modal-compact-content">
              <div className="compact-row">
                <span className="compact-label">Operation:</span>
                <span className="compact-value">{selectedAudit.operation}</span>
              </div>
              <div className="compact-row">
                <span className="compact-label">Actor:</span>
                <span className="compact-value">
                  {selectedAudit.actor}
                  {selectedAudit.actor_email && ` ${selectedAudit.actor_email}`}
                </span>
              </div>
              {selectedAudit.details && (() => {
                try {
                  const parsed = typeof selectedAudit.details === 'string' ? JSON.parse(selectedAudit.details) : selectedAudit.details;
                  const actorIp = parsed?.ipAddress || parsed?.clientIP || parsed?.actor_ip;
                  const actorLocation = parsed?.location?.countryOrRegion || parsed?.actor_location || parsed?.city || parsed?.country;
                  return (
                    <>
                      {actorIp && (
                        <div className="compact-row">
                          <span className="compact-label">Actor IP:</span>
                          <span className="compact-value">{actorIp}</span>
                        </div>
                      )}
                      {actorLocation && (
                        <div className="compact-row">
                          <span className="compact-label">Actor location:</span>
                          <span className="compact-value">{actorLocation}</span>
                        </div>
                      )}
                    </>
                  );
                } catch {
                  return null;
                }
              })()}
              <div className="compact-row">
                <span className="compact-label">Object:</span>
                <span className="compact-value">
                  {selectedAudit.object}
                  {selectedAudit.object_type && (
                    <span className="object-type-inline">({selectedAudit.object_type})</span>
                  )}
                </span>
              </div>
              <div className="compact-row">
                <span className="compact-label">Date:</span>
                <span className="compact-value">{formatDate(selectedAudit.date)}</span>
              </div>
              {selectedAudit.details && (() => {
                try {
                  const parsed = typeof selectedAudit.details === 'string' ? JSON.parse(selectedAudit.details) : selectedAudit.details;
                  const showContent = parsed?.showContent !== undefined ? parsed.showContent : parsed?.show_content;
                  return showContent !== undefined ? (
                    <div className="compact-row">
                      <span className="compact-label">Show content:</span>
                      <span className="compact-value">{showContent ? 'On' : 'Off'}</span>
                    </div>
                  ) : null;
                } catch {
                  return null;
                }
              })()}
              {selectedAudit.enrichment?.sla_policy && (
                <div className="compact-row">
                  <span className="compact-label">SLA Policy:</span>
                  <span className="compact-value">{selectedAudit.enrichment.sla_policy}</span>
                </div>
              )}
              {selectedAudit.enrichment?.last_backup_at && (
                <div className="compact-row">
                  <span className="compact-label">Last Backup:</span>
                  <span className="compact-value">{formatDate(selectedAudit.enrichment.last_backup_at)}</span>
                </div>
              )}
              {selectedAudit.risk_signals && (
                <div className="compact-row">
                  <span className="compact-label">Risk Level:</span>
                  <span className="compact-value">{getRiskBadge(selectedAudit.risk_level || 'N/A', selectedAudit.risk_score || 0)}</span>
                </div>
              )}
              {selectedAudit.details && (
                <button className="view-raw-btn-compact" onClick={() => handleViewRawDetails(selectedAudit)}>
                  View Raw JSON
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== RAW JSON MODAL ==================== */}
      {showRawModal && rawDetails && (
        <div className="modal-overlay" onClick={closeRawModal}>
          <div className="raw-json-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Raw Event Data</h3>
              <button className="modal-close" onClick={closeRawModal}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <pre className="raw-json-content">
              {JSON.stringify(rawDetails, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
