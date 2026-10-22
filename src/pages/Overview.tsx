import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fmtLocal, parseAsUtc } from '../utils/datetime';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import './Overview.css';
import { API } from '../config/api';
import { formatNumber } from '../utils/display';
import { getActivities, type ActivityItem as ActivityRow } from '../services/activity';
import { triggerDatasourceBackup } from '../services/resource';

interface BackupSizeResponse {
  total: string;
  oneDayChange: string;
  oneMonthChange: string;
  allTimeTotal: string;
  dailyData: { date: string; bytes: number }[];
}

interface ProtectionStatus {
  percentage: number;
  users?: { protectedCount: number; total: number };
  sharedMailboxes?: { protectedCount: number; total: number };
  rooms?: { protectedCount: number; total: number };
  sharepointSites?: { protectedCount: number; total: number };
  groupsAndTeams?: { protectedCount: number; total: number };
  entraId?: { protectedCount: number; total: number };
  powerPlatform?: { protectedCount: number; total: number };
  virtualMachines?: { protectedCount: number; total: number };
  sqlDatabases?: { protectedCount: number; total: number };
  postgresqlDatabases?: { protectedCount: number; total: number };
}

interface Status24hResponse {
  success: number;
  warnings: number;
  failures: number;
  // Optional, supplied by dashboard-service once it counts non-terminal
  // jobs (see the TMV-022 note on the 24-hour card below). Until then the
  // card derives both from the activity feed it already fetches, so the
  // page never claims "Success" while a run is hung. Both fields are
  // additive — an older backend simply omits them.
  inProgress?: number;
  stalled?: number;
}

interface Status7dResponse {
  dailyStatus: { date: string; success: number; warnings: number; failures: number }[];
  summary: { totalBackups: number; successRate: number; avgDuration: string };
}

interface Status7dChartDatum {
  date: string;
  shortDate: string;
  fullDate: string;
  success: number;
  warnings: number;
  failures: number;
  total: number;
}

interface BackupSizeChartDatum {
  date: string;
  shortDate: string;
  fullDate: string;
  bytes: number;
}

type SizeUnit = 'MB' | 'GB' | 'TB';

const CHART_COLORS = {
  // Semantic colors — fixed across light AND dark themes per user spec:
  // success = green, warning = yellow/amber, failure = red. Picked to
  // stay legible on both the warm-white and warm-grey surfaces without
  // needing theme-aware swapping in JS (recharts fill is evaluated once
  // per render and these mid-tone values read on both backgrounds).
  success: '#16a34a',   // tailwind green-600
  warning: '#f59e0b',   // amber-500 (unchanged)
  failure: '#dc2626',   // red-600
  backup: '#D31245',    // brand red for non-status bars (storage usage)
};

function calculateProtectionTotals(data: ProtectionStatus): { protectedCount: number; totalCount: number; percentage: number } {
  const allCategories = Object.values(data).filter(
    (value): value is { protectedCount: number; total: number } =>
      typeof value === 'object' && value !== null && 'protectedCount' in value && 'total' in value
  );

  const totalCount = allCategories.reduce((sum, cat) => sum + cat.total, 0);
  const protectedCount = allCategories.reduce((sum, cat) => sum + cat.protectedCount, 0);
  const percentage = totalCount > 0 ? (protectedCount / totalCount) * 100 : 0;

  return { protectedCount, totalCount, percentage };
}

function formatDateShort(dateStr: string): string {
  return fmtLocal(dateStr, { month: 'short', day: 'numeric' });
}

function formatDateLong(dateStr: string): string {
  return fmtLocal(dateStr, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatGB(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    const gb = bytes / (1024 * 1024 * 1024);
    return gb < 10 ? `${gb.toFixed(1)} GB` : `${Math.round(gb)} GB`;
  } else if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  }
  return '0 GB';
}

function getChartSizeUnit(maxBytes: number): SizeUnit {
  if (maxBytes >= 1024 * 1024 * 1024 * 1024) return 'TB';
  if (maxBytes >= 1024 * 1024 * 1024) return 'GB';
  return 'MB';
}

function formatBytesInUnit(bytes: number, unit: SizeUnit): string {
  const divisors = {
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
    TB: 1024 * 1024 * 1024 * 1024,
  };

  const value = bytes / divisors[unit];

  if (value === 0) return `0 ${unit}`;
  if (value < 10) return `${value.toFixed(1)} ${unit}`;
  return `${Math.round(value)} ${unit}`;
}

function StatusChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: Status7dChartDatum }>;
}) {
  if (!active || !payload?.length) return null;

  const data = payload[0].payload;

  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">{data.fullDate}</div>
      <div className="chart-tooltip-row success">
        <span>Success</span>
        <strong>{data.success}</strong>
      </div>
      <div className="chart-tooltip-row warning">
        <span>Warnings</span>
        <strong>{data.warnings}</strong>
      </div>
      <div className="chart-tooltip-row failure">
        <span>Failures</span>
        <strong>{data.failures}</strong>
      </div>
      <div className="chart-tooltip-total">
        <span>Total</span>
        <strong>{data.total}</strong>
      </div>
    </div>
  );
}

function BackupSizeTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: BackupSizeChartDatum }>;
}) {
  if (!active || !payload?.length) return null;

  const data = payload[0].payload;

  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">{data.fullDate}</div>
      <div className="chart-tooltip-row backup">
        <span>Added</span>
        <strong>{formatGB(data.bytes)}</strong>
      </div>
    </div>
  );
}

/**
 * Failure state for one dashboard card (TMV-005).
 *
 * A card whose request failed must look different from a card whose
 * request is still running, and must offer a way out that isn't a full
 * page reload — the aggregate poll only re-attempts every ~60s while the
 * tenant is idle, and never at all if the activity request in the same
 * tick throws first.
 */
function CardError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="card-error" role="status">
      <div className="card-error-text">Couldn't load this card</div>
      <div className="card-error-detail" title={message}>{message}</div>
      <button type="button" className="card-error-retry" onClick={onRetry}>Retry</button>
    </div>
  );
}

function appendDashboardFilters(url: string, tenantId?: string, serviceType?: string): string {
  const queryParams = new URLSearchParams();
  if (tenantId) queryParams.append('tenantId', tenantId);
  if (serviceType === 'm365' || serviceType === 'azure') queryParams.append('serviceType', serviceType);
  const query = queryParams.toString();
  if (!query) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${query}`;
}

// Which aggregate cards failed on their most recent attempt. A card with
// an entry here renders an error + Retry instead of a spinner.
type CardKey = 'backupSize' | 'protection' | 'status24h' | 'status7d';

/**
 * Fetch one dashboard aggregate, failing loudly.
 *
 * 2026-08-11 (TMV-005): the four aggregates were fetched as
 * `fetch(url).then(r => r.json())` with no `r.ok` check, and the caller
 * swallowed rejections into `console.error`. Any non-JSON error response
 * therefore left the card's state at `null` forever, and every card
 * renders `null` as the string "Loading…" — so a 502 from a restarting
 * api-gateway is displayed to the user as an eternal spinner with no
 * error, no retry and nothing on screen to distinguish it from a slow
 * request.
 *
 * Measured in a headless-chromium reproduction against the real
 * production payloads (2026-08-11): with backup/size answering 502 the
 * card reads "Loading..." indefinitely and the only trace is
 * `SyntaxError: Unexpected token '<', "<html><hea"... is not valid JSON`
 * in the console. With the endpoint healthy the same build renders
 * "541.9 GB", which is why this finding did not reproduce on re-test —
 * the defect is the unrecoverable failure mode, not the happy path.
 */
async function fetchAggregate<T>(url: string, headers: Record<string, string>): Promise<T> {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    // Body may be an nginx HTML error page — never feed it to json().
    throw new Error(`${res.status} ${res.statusText || 'request failed'}`);
  }
  return (await res.json()) as T;
}

export default function Overview() {
  const { tenantId, serviceType } = useParams<{ tenantId: string; serviceType: string }>();
  const [backupSize, setBackupSize] = useState<BackupSizeResponse | null>(null);
  const [protection, setProtection] = useState<ProtectionStatus | null>(null);
  const [status24h, setStatus24h] = useState<Status24hResponse | null>(null);
  const [status7d, setStatus7d] = useState<Status7dResponse | null>(null);
  const [cardErrors, setCardErrors] = useState<Partial<Record<CardKey, string>>>({});
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [activitiesLoaded, setActivitiesLoaded] = useState(false);
  const [triggeringBackupAll, setTriggeringBackupAll] = useState(false);
  // Bumped by the Retry buttons to re-run the loader effect.
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    const headers: Record<string, string> = {};

    let cancelled = false;

    // Initial fetch + every-N-seconds refresh. We always refresh the
    // activity feed; dashboard aggregates (backup size, protection %,
    // 24h / 7d rollups) get refreshed too whenever there's an
    // in-flight backup/restore since those numbers change as jobs
    // complete. Once everything settles, aggregate refresh backs off
    // to every 4th tick (~1 minute) so a quiet tenant isn't hammering
    // four endpoints just to re-confirm unchanged totals.
    let idleTicks = 0;
    // All five requests fire in parallel and each card paints as its
    // own response lands — the page must never block on the slowest
    // aggregate (2026-07-29: a cold backup/size recompute held the
    // whole page's spinner for 16s; see dashboard-service prewarm fix).
    // withActivity=false lets the poll tick skip re-fetching activity
    // when the tick itself already fetched it (the old shape fetched
    // activity twice per aggregate refresh).
    const loadAll = async (withAggregates: boolean, withActivity = true) => {
      // `key` is what tells the card apart from "still loading": on
      // success we clear the error, on failure we record it. Without
      // that the card can only ever say "Loading…" (TMV-005).
      const settle = <T,>(key: CardKey, p: Promise<T>, set: (v: T) => void) =>
        p.then((v) => {
          if (cancelled) return;
          set(v);
          setCardErrors((prev) => {
            if (!(key in prev)) return prev;
            const next = { ...prev };
            delete next[key];
            return next;
          });
        }).catch((err) => {
          console.error(`dashboard ${key} failed:`, err);
          if (cancelled) return;
          setCardErrors((prev) => ({ ...prev, [key]: String(err?.message ?? err) }));
        });
      const work: Promise<void>[] = [];
      if (withActivity) {
        work.push(
          getActivities({
            tenantId,
            serviceType: serviceType === 'm365' || serviceType === 'azure' ? serviceType : undefined,
            page: 1,
            size: 10,
          }).then((d) => {
            if (cancelled) return;
            setActivities(d.items || []);
            setActivitiesLoaded(true);
          }).catch((err) => console.error(err)),
        );
      }
      if (withAggregates) {
        work.push(
          settle('backupSize', fetchAggregate<BackupSizeResponse>(appendDashboardFilters(API.DASHBOARD.BACKUP_SIZE, tenantId, serviceType), headers), setBackupSize),
          settle('protection', fetchAggregate<ProtectionStatus>(appendDashboardFilters(API.DASHBOARD.PROTECTION, tenantId, serviceType), headers), setProtection),
          settle('status24h', fetchAggregate<Status24hResponse>(appendDashboardFilters(API.DASHBOARD.STATUS_24H, tenantId, serviceType), headers), setStatus24h),
          settle('status7d', fetchAggregate<Status7dResponse>(appendDashboardFilters(API.DASHBOARD.STATUS_7D, tenantId, serviceType), headers), setStatus7d),
        );
      }
      await Promise.allSettled(work);
    };

    loadAll(true);
    const poll = setInterval(async () => {
      // Always fetch activity first so we can decide whether
      // aggregates need a refresh based on the latest status.
      try {
        const activityData = await getActivities({
          tenantId,
          serviceType: serviceType === 'm365' || serviceType === 'azure' ? serviceType : undefined,
          page: 1, size: 10,
        });
        if (cancelled) return;
        setActivities(activityData.items || []);
        setActivitiesLoaded(true);
        // Mirror the staleness guard from `hasLiveBackup` below — a
        // worker that died mid-flight leaves rows pinned at
        // 'In Progress' forever, and we don't want the aggregate
        // refresher to burn cycles on a phantom run.
        const STALE_MS = 45 * 60 * 1000;
        const anyLive = (activityData.items || []).some((a) => {
          if (a.status !== 'In Progress') return false;
          if (!a.start_time) return true;
          const age = Date.now() - new Date(a.start_time).getTime();
          return !(Number.isFinite(age) && age > STALE_MS);
        });
        // Aggregates change as backups complete — refresh on every
        // tick while something is in-flight, else every 4th tick.
        const shouldRefreshAggregates = anyLive || idleTicks >= 3;
        if (shouldRefreshAggregates) {
          idleTicks = 0;
          await loadAll(true, false);
        } else {
          idleTicks += 1;
        }
      } catch (err) {
        console.error(err);
      }
    }, 15_000);

    // Refresh immediately when the tab becomes visible again so the
    // user isn't looking at stale rows after alt-tabbing.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') loadAll(false);
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [tenantId, serviceType, reloadNonce]);

  const retryAggregates = () => setReloadNonce((n) => n + 1);

  const hasFailures24h = (status24h?.failures || 0) > 0;

  const status7dChartData: Status7dChartDatum[] = (status7d?.dailyStatus || []).slice(-7).map((d) => ({
    date: d.date,
    shortDate: formatDateShort(d.date),
    fullDate: formatDateLong(d.date),
    success: d.success,
    warnings: d.warnings,
    failures: d.failures,
    total: d.success + d.warnings + d.failures,
  }));

  const backupSizeChartData: BackupSizeChartDatum[] = (backupSize?.dailyData || []).slice(-7).map((d) => ({
    date: d.date,
    shortDate: formatDateShort(d.date),
    fullDate: formatDateLong(d.date),
    bytes: d.bytes,
  }));
  const backupSizeChartMax = backupSizeChartData.reduce((max, point) => Math.max(max, point.bytes), 0);
  const backupSizeChartUnit = getChartSizeUnit(backupSizeChartMax);

  const status7dTotals = status7dChartData.reduce(
    (acc, day) => ({
      success: acc.success + day.success,
      warnings: acc.warnings + day.warnings,
      failures: acc.failures + day.failures,
    }),
    { success: 0, warnings: 0, failures: 0 }
  );

  // ---- 24-hour card: in-progress / stalled (TMV-022) ------------------
  //
  // 2026-08-11, tenant 163c487b: /dashboard/status/24hour answered
  // {"success":2,"warnings":0,"failures":0} while the activity feed on the
  // SAME page carried two BACKUP rows still 'In Progress', started
  // 2026-08-11T10:07:01Z and 18:07:01Z. The 10:07 run had been running for
  // over eleven hours. The card therefore rendered a green "Success"
  // headline over a tenant with a hung backup — the single most misleading
  // state this page can be in.
  //
  // The counts themselves are the backend's to derive: dashboard-service
  // owns the 24-hour window and should return `inProgress` and `stalled`
  // alongside success/warnings/failures (a job is stalled when it has been
  // non-terminal for longer than the tenant's expected run duration). This
  // is the RENDERING half:
  //   - prefer the backend's numbers the moment they exist,
  //   - otherwise derive them from the activity feed this page already
  //     fetched, so the headline is honest today,
  //   - never say "Success" while anything is in flight or stalled.
  //
  // The derived numbers are a LOWER BOUND: the feed is fetched with
  // size=10, so an eleventh stuck job is not counted. That is fine for
  // the headline (one stalled job is enough to stop saying "Success")
  // and is the reason the backend should own the real count.
  //
  // STALE_MS reuses the same 45-minute cutoff as the "Backup all" button
  // below (largest historical single-tenant batch is ~25 min).
  const JOB_STALE_MS = 45 * 60 * 1000;
  const WINDOW_24H_MS = 24 * 60 * 60 * 1000;
  const derived24h = (() => {
    let inProgress = 0;
    let stalled = 0;
    const now = Date.now();
    for (const a of activities) {
      if (a.status !== 'In Progress') continue;
      // parseAsUtc, NOT new Date(): /activity returns NAIVE ISO strings
      // (2026-08-11T18:07:01.871866) and JS parses those as LOCAL time.
      // In MST that under-counts every job age by 7h, so a genuinely hung
      // backup would read "In progress" instead of "Stalled" for its first
      // 7h45m — delaying the exact escalation signal this card exists to
      // produce. East of UTC the error inverts into false "Stalled" alarms
      // on healthy minutes-old jobs, which could prompt someone to cancel a
      // live backup. Protection.tsx already uses parseAsUtc for this reason.
      const started = a.start_time ? (parseAsUtc(a.start_time)?.getTime() ?? NaN) : NaN;
      const ageMs = Number.isFinite(started) ? now - started : NaN;
      // Rows older than the 24h window are not this card's business
      // unless they are still running — a run that started 30h ago and
      // has never finished is exactly what we must surface.
      if (Number.isFinite(ageMs) && ageMs > JOB_STALE_MS) stalled += 1;
      else if (!Number.isFinite(ageMs) || ageMs <= WINDOW_24H_MS) inProgress += 1;
    }
    return { inProgress, stalled };
  })();
  const inProgress24h = status24h?.inProgress ?? derived24h.inProgress;
  const stalled24h = status24h?.stalled ?? derived24h.stalled;

  const status24hState = hasFailures24h
    ? { label: 'Failures', className: 'failure' }
    : stalled24h > 0
      ? { label: 'Stalled', className: 'failure' }
      : (status24h?.warnings || 0) > 0
        ? { label: 'Warnings', className: 'warning' }
        : inProgress24h > 0
          ? { label: 'In progress', className: 'running' }
          : { label: 'Success', className: 'success' };

  const protectionRows = protection
    ? (serviceType === 'azure'
      ? [
          { label: 'VM', value: protection.virtualMachines },
          { label: 'SQL DB', value: protection.sqlDatabases },
          { label: 'PostgreSQL DB', value: protection.postgresqlDatabases },
        ]
      : [
          { label: 'Users', value: protection.users },
          { label: 'Shared mailboxes', value: protection.sharedMailboxes },
          { label: 'Rooms', value: protection.rooms },
          { label: 'SharePoint sites', value: protection.sharepointSites },
          { label: 'Groups & Teams', value: protection.groupsAndTeams },
          { label: 'Entra ID', value: protection.entraId },
          { label: 'Power Platform', value: protection.powerPlatform },
        ]).filter((item): item is { label: string; value: { protectedCount: number; total: number } } => !!item.value && item.value.total > 0)
    : [];

  // Any in-flight activity for the current tenant/service keeps the
  // "Backup all" button disabled — clicking it again would race the
  // running batch (and the backend dedupes it anyway, so it's a wasted
  // round-trip + UI confusion). The 15s activity poll already refreshes
  // this list, so the button re-enables on its own once everything
  // completes.
  //
  // Staleness guard: a worker dying mid-flight (lease expiry, infra
  // restart, manual redeploy) can leave an activity row pinned at
  // 'In Progress' with no one to flip it. Without a cutoff, the
  // "Backup in progress..." label is sticky forever and the user is
  // locked out of triggering a new run. 45 minutes is comfortably
  // longer than any realistic single-tenant batch in this product
  // (largest historical run is ~25 min), so anything beyond that is
  // a stale row and we should treat it as not-live. Same cutoff the
  // 24-hour card uses to split "in progress" from "stalled" (JOB_STALE_MS).
  const hasLiveBackup = activities.some((a) => {
    if (a.status !== 'In Progress') return false;
    if (!a.start_time) return true; // missing timestamp — assume live, conservative
    const ageMs = Date.now() - new Date(a.start_time).getTime();
    return !(Number.isFinite(ageMs) && ageMs > JOB_STALE_MS);
  });

  const handleBackupAll = async () => {
    if (!tenantId || (serviceType !== 'm365' && serviceType !== 'azure')) return;

    setTriggeringBackupAll(true);
    try {
      await triggerDatasourceBackup(tenantId, serviceType, true);
      const refreshedActivities = await getActivities({
        tenantId,
        serviceType: serviceType === 'm365' || serviceType === 'azure' ? serviceType : undefined,
        page: 1,
        size: 10,
      });
      setActivities(refreshedActivities.items || []);
    } catch (error) {
      console.error('Failed to trigger datasource backup:', error);
    } finally {
      setTriggeringBackupAll(false);
    }
  };

  const formatActivityDate = (dateString: string) => {
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

  return (
    <div className="overview-page">
      <div className="status-cards">
        {/* 24-hour status */}
        <div className="status-card status-summary-card">
          <div className="status-card-header">
            <span className="status-label">24-hour status</span>
          </div>
          <div className="status-card-value">
            {cardErrors.status24h ? (
              <CardError message={cardErrors.status24h} onRetry={retryAggregates} />
            ) : !status24h ? (
              <span style={{ color: '#94a3b8' }}>Loading...</span>
            ) : (
              <div className="status-summary-content">
                <div className={`status-summary-title ${status24hState.className}`}>
                  {status24hState.label}
                </div>
                <div className="status-summary-list">
                  <div className="status-summary-row success">
                    <span>Success</span>
                    <strong>{formatNumber(status24h?.success || 0)}</strong>
                  </div>
                  <div className="status-summary-row warning">
                    <span>Warnings</span>
                    <strong>{formatNumber(status24h?.warnings || 0)}</strong>
                  </div>
                  <div className="status-summary-row failure">
                    <span>Failures</span>
                    <strong>{formatNumber(status24h?.failures || 0)}</strong>
                  </div>
                  {inProgress24h > 0 && (
                    <div className="status-summary-row running">
                      <span>In progress</span>
                      <strong>{formatNumber(inProgress24h)}</strong>
                    </div>
                  )}
                  {stalled24h > 0 && (
                    <div
                      className="status-summary-row stalled"
                      title={`Running for more than ${Math.round(JOB_STALE_MS / 60000)} minutes with no result — check the Activity page.`}
                    >
                      <span>Stalled</span>
                      <strong>{formatNumber(stalled24h)}</strong>
                    </div>
                  )}
                </div>
                <button
                  className="backup-all-btn status-summary-btn"
                  onClick={handleBackupAll}
                  disabled={!tenantId || !serviceType || triggeringBackupAll || hasLiveBackup}
                  title={hasLiveBackup ? 'A backup is currently running for this tenant.' : undefined}
                >
                  {triggeringBackupAll
                    ? 'Starting backup...'
                    : hasLiveBackup
                      ? 'Backup in progress...'
                      : `Backup all ${serviceType === 'azure' ? 'Azure' : 'M365'} now`}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 7-day status */}
        <div className="status-card chart-card">
          <div className="status-card-header">
            <span className="status-label">7-day status</span>
          </div>
          <div className="status-card-value">
            {cardErrors.status7d ? (
              <CardError message={cardErrors.status7d} onRetry={retryAggregates} />
            ) : !status7d ? (
              <span style={{ color: '#94a3b8' }}>Loading...</span>
            ) : (
              <div className="chart-card-content">
                <div className="chart-legend">
                  <span className="chart-legend-item success">Success {formatNumber(status7dTotals.success)}</span>
                  <span className="chart-legend-item warning">Warnings {formatNumber(status7dTotals.warnings)}</span>
                  <span className="chart-legend-item failure">Failures {formatNumber(status7dTotals.failures)}</span>
                </div>
                <div className="chart-shell">
                  {/* initialDimension, not minHeight. recharts 3.x seeds its
                      size state with {width:-1,height:-1} and warns "The
                      width(-1) and height(-1) of chart should be greater than
                      0" on the render BEFORE its ResizeObserver has measured;
                      minWidth/minHeight only appear in that message's text
                      (recharts/es6/component/ResponsiveContainer.js:135, the
                      warn reads calculateChartDimensions' output). Seeding the
                      height with .chart-shell's own min-height satisfies the
                      `calculatedHeight > 0` arm. Width stays -1 so
                      isAcceptableSize() still withholds the chart until the
                      real width is known — same paint, no console noise.
                      Reproduced + verified in headless chromium 2026-08-11. */}
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                    minWidth={0}
                    minHeight={0}
                    initialDimension={{ width: -1, height: 190 }}
                  >
                    <BarChart data={status7dChartData} barGap={6} margin={{ top: 8, right: 8, left: 8, bottom: 6 }}>
                      <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="shortDate"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 11, fill: '#94a3b8' }}
                      />
                      <YAxis
                        allowDecimals={false}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 11, fill: '#94a3b8' }}
                        tickMargin={8}
                        width={40}
                      />
                      <Tooltip
                        cursor={{ fill: 'rgba(148, 163, 184, 0.12)' }}
                        content={<StatusChartTooltip />}
                      />
                      <Bar dataKey="success" stackId="status" fill={CHART_COLORS.success} radius={[4, 4, 0, 0]} maxBarSize={30} />
                      <Bar dataKey="warnings" stackId="status" fill={CHART_COLORS.warning} radius={[4, 4, 0, 0]} maxBarSize={30} />
                      <Bar dataKey="failures" stackId="status" fill={CHART_COLORS.failure} radius={[4, 4, 0, 0]} maxBarSize={30} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Protection status */}
        <div className="status-card protection-card">
          <div className="status-card-header">
            <span className="status-label">Protection status</span>
          </div>
          <div className="status-card-value">
            {cardErrors.protection ? (
              <CardError message={cardErrors.protection} onRetry={retryAggregates} />
            ) : !protection ? (
              <span style={{ color: '#94a3b8' }}>Loading...</span>
            ) : (() => {
              const totals = calculateProtectionTotals(protection);
              const CIRC = 2 * Math.PI * 16;
              // 2026-08-11 (TMV-022): this tenant protects 13 of 29,641
              // resources = 0.04%, so Math.round gave "0%" and the arc's
              // dash offset was the full circumference — an empty grey
              // ring that reads identically to "no data loaded". Show
              // "<1%" for a non-zero-but-tiny ratio, keep a 2% minimum
              // sweep so the arc is visible, and label a genuinely empty
              // tenant explicitly.
              const rounded = Math.round(totals.percentage);
              const pctLabel = totals.totalCount === 0
                ? 'No resources'
                : totals.protectedCount === 0
                  ? '0%'
                  : rounded === 0
                    ? '<1%'
                    : `${rounded}%`;
              const sweep = totals.protectedCount > 0
                ? Math.max(2, Math.min(100, totals.percentage))
                : 0;
              return (
                <div className="protection-card-content">
                  <div className="protection-summary">
                    <div
                      className={`protection-summary-value ${totals.totalCount === 0 ? 'empty' : ''}`}
                      title={`${formatNumber(totals.protectedCount)} of ${formatNumber(totals.totalCount)} resources protected`}
                    >
                      {pctLabel}
                    </div>
                    <svg
                      className="protection-ring"
                      width="40"
                      height="40"
                      style={{ transform: 'rotate(-90deg)' }}
                      role="img"
                      aria-label={`${formatNumber(totals.protectedCount)} of ${formatNumber(totals.totalCount)} resources protected`}
                    >
                      <circle cx="20" cy="20" r="16" fill="none" stroke="#e2e8f0" strokeWidth="4" />
                      {sweep > 0 && (
                        <circle cx="20" cy="20" r="16" fill="none" stroke="#D31245" strokeWidth="4"
                          strokeDasharray={`${CIRC}`}
                          strokeDashoffset={`${CIRC * (1 - sweep / 100)}`}
                          strokeLinecap="round" />
                      )}
                    </svg>
                  </div>
                  <div className="protection-breakdown">
                    {protectionRows.map((item) => {
                      const isPartial = item.value.protectedCount !== item.value.total;
                      return (
                        <div key={item.label} className="protection-breakdown-row">
                          <span className="protection-breakdown-label">{item.label}</span>
                          <span className={`protection-breakdown-value ${isPartial ? 'partial' : 'complete'}`}>
                            {formatNumber(item.value.protectedCount)} / {formatNumber(item.value.total)}
                          </span>
                        </div>
                      );
                    })}
                    {protectionRows.length === 0 && (
                      <div className="protection-breakdown-row">
                        <span className="protection-breakdown-label">No resources discovered yet</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Backup size */}
        <div className="status-card chart-card">
          <div className="status-card-header">
            <span className="status-label">Backup size</span>
          </div>
          <div className="status-card-value">
            {cardErrors.backupSize ? (
              <CardError message={cardErrors.backupSize} onRetry={retryAggregates} />
            ) : (
            <div className="chart-card-content">
              <div className="backup-size-summary">
                <div className="backup-size-headline">
                  <div className="backup-size-total">
                    {!backupSize ? 'Loading...' : (backupSize.total || '0 GB')}
                  </div>
                </div>
                <div className="backup-size-metrics">
                  {backupSize?.oneMonthChange && (
                    <div className="backup-size-pill positive">
                      <span>7 days</span>
                      <strong>{backupSize.oneMonthChange}</strong>
                    </div>
                  )}
                  {backupSize?.allTimeTotal && (
                    <div className="backup-size-pill neutral">
                      <span>All time</span>
                      <strong>{backupSize.allTimeTotal}</strong>
                    </div>
                  )}
                </div>
              </div>

              {backupSizeChartData.length > 0 && (
                <div className="chart-shell">
                  {/* See the 7-day card for why initialDimension is set. */}
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                    minWidth={0}
                    minHeight={0}
                    initialDimension={{ width: -1, height: 190 }}
                  >
                    <BarChart data={backupSizeChartData} barGap={8} margin={{ top: 8, right: 8, left: 8, bottom: 6 }}>
                      <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="shortDate"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 11, fill: '#94a3b8' }}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 11, fill: '#94a3b8' }}
                        tickFormatter={(value: number) => formatBytesInUnit(value, backupSizeChartUnit)}
                        tickMargin={8}
                        width={64}
                      />
                      <Tooltip
                        cursor={{ fill: 'rgba(13, 148, 136, 0.10)' }}
                        content={<BackupSizeTooltip />}
                      />
                      <Bar dataKey="bytes" fill={CHART_COLORS.backup} radius={[4, 4, 0, 0]} maxBarSize={34} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
            )}
          </div>
        </div>
      </div>

      {/* Activity Table */}
      <div className="activity-section">
        <h2 className="activity-title">Recent Activity</h2>
        <div className="activity-table-container">
          <table className="activity-table">
            <thead>
              <tr>
                <th>Object</th>
                <th>Operation</th>
                <th>Started</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {activities.map((activity) => (
                <tr key={activity.id}>
                  <td className="activity-tenant">{activity.object}</td>
                  <td>{activity.operation}</td>
                  <td>{formatActivityDate(activity.start_time)}</td>
                  <td>
                    <span className={`activity-status ${
                      activity.status === 'Done' ? 'done' :
                      activity.status === 'In Progress' ? 'in-progress' :
                      activity.status === 'Warning' ? 'warning' :
                      activity.status === 'Canceled' ? 'failed' : 'failed'
                    }`}>
                      {activity.status === 'In Progress' && <span className="spinner-small" />}
                      {activity.status}
                    </span>
                  </td>
                </tr>
              ))}
              {activitiesLoaded && activities.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-muted" style={{ textAlign: 'center' }}>
                    No recent activity for this datasource yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
