import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fmtLocal } from '../utils/datetime';
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
        <span>Backup size</span>
        <strong>{formatGB(data.bytes)}</strong>
      </div>
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

export default function Overview() {
  const { tenantId, serviceType } = useParams<{ tenantId: string; serviceType: string }>();
  const [backupSize, setBackupSize] = useState<BackupSizeResponse | null>(null);
  const [protection, setProtection] = useState<ProtectionStatus | null>(null);
  const [status24h, setStatus24h] = useState<Status24hResponse | null>(null);
  const [status7d, setStatus7d] = useState<Status7dResponse | null>(null);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggeringBackupAll, setTriggeringBackupAll] = useState(false);

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
    const loadAll = async (withAggregates: boolean) => {
      try {
        if (withAggregates) {
          const [backupData, protectionData, data24h, data7d] = await Promise.all([
            fetch(appendDashboardFilters(API.DASHBOARD.BACKUP_SIZE, tenantId, serviceType), { headers }).then(r => r.json()),
            fetch(appendDashboardFilters(API.DASHBOARD.PROTECTION, tenantId, serviceType), { headers }).then(r => r.json()),
            fetch(appendDashboardFilters(API.DASHBOARD.STATUS_24H, tenantId, serviceType), { headers }).then(r => r.json()),
            fetch(appendDashboardFilters(API.DASHBOARD.STATUS_7D, tenantId, serviceType), { headers }).then(r => r.json()),
          ]);
          if (cancelled) return;
          setBackupSize(backupData);
          setProtection(protectionData);
          setStatus24h(data24h);
          setStatus7d(data7d);
        }
        const activityData = await getActivities({
          tenantId,
          serviceType: serviceType === 'm365' || serviceType === 'azure' ? serviceType : undefined,
          page: 1,
          size: 10,
        });
        if (cancelled) return;
        setActivities(activityData.items || []);
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled && withAggregates) setLoading(false);
      }
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
        const anyLive = (activityData.items || []).some(
          (a) => a.status === 'In Progress',
        );
        // Aggregates change as backups complete — refresh on every
        // tick while something is in-flight, else every 4th tick.
        const shouldRefreshAggregates = anyLive || idleTicks >= 3;
        if (shouldRefreshAggregates) {
          idleTicks = 0;
          await loadAll(true);
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
  }, [tenantId, serviceType]);

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

  const status24hState = hasFailures24h
    ? { label: 'Failures', className: 'failure' }
    : (status24h?.warnings || 0) > 0
      ? { label: 'Warnings', className: 'warning' }
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
            {loading ? (
              <span style={{ color: '#94a3b8' }}>Loading...</span>
            ) : (
              <div className="status-summary-content">
                <div className={`status-summary-title ${status24hState.className}`}>
                  {status24hState.label}
                </div>
                <div className="status-summary-list">
                  <div className="status-summary-row success">
                    <span>Success</span>
                    <strong>{status24h?.success || 0}</strong>
                  </div>
                  <div className="status-summary-row warning">
                    <span>Warnings</span>
                    <strong>{status24h?.warnings || 0}</strong>
                  </div>
                  <div className="status-summary-row failure">
                    <span>Failures</span>
                    <strong>{status24h?.failures || 0}</strong>
                  </div>
                </div>
                <button
                  className="backup-all-btn status-summary-btn"
                  onClick={handleBackupAll}
                  disabled={!tenantId || !serviceType || triggeringBackupAll}
                >
                  {triggeringBackupAll ? 'Starting backup...' : `Backup all ${serviceType === 'azure' ? 'Azure' : 'M365'} now`}
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
            {loading ? (
              <span style={{ color: '#94a3b8' }}>Loading...</span>
            ) : (
              <div className="chart-card-content">
                <div className="chart-legend">
                  <span className="chart-legend-item success">Success {status7dTotals.success}</span>
                  <span className="chart-legend-item warning">Warnings {status7dTotals.warnings}</span>
                  <span className="chart-legend-item failure">Failures {status7dTotals.failures}</span>
                </div>
                <div className="chart-shell">
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
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
            {loading ? (
              <span style={{ color: '#94a3b8' }}>Loading...</span>
            ) : (() => {
              const totals = protection ? calculateProtectionTotals(protection) : { protectedCount: 0, totalCount: 0, percentage: 0 };
              return (
                <div className="protection-card-content">
                  <div className="protection-summary">
                    <div className="protection-summary-value">
                      {totals.totalCount > 0 ? `${Math.round(totals.percentage)}%` : '0%'}
                    </div>
                    <svg className="protection-ring" width="40" height="40" style={{ transform: 'rotate(-90deg)' }}>
                      <circle cx="20" cy="20" r="16" fill="none" stroke="#e2e8f0" strokeWidth="4" />
                      <circle cx="20" cy="20" r="16" fill="none" stroke="#D31245" strokeWidth="4"
                        strokeDasharray={`${2 * Math.PI * 16}`}
                        strokeDashoffset={`${2 * Math.PI * 16 * (1 - totals.percentage / 100)}`}
                        strokeLinecap="round" />
                    </svg>
                  </div>
                  <div className="protection-breakdown">
                    {protectionRows.map((item) => {
                      const isPartial = item.value.protectedCount !== item.value.total;
                      return (
                        <div key={item.label} className="protection-breakdown-row">
                          <span className="protection-breakdown-label">{item.label}</span>
                          <span className={`protection-breakdown-value ${isPartial ? 'partial' : 'complete'}`}>
                            {item.value.protectedCount} / {item.value.total}
                          </span>
                        </div>
                      );
                    })}
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
            <div className="chart-card-content">
              <div className="backup-size-summary">
                <div className="backup-size-headline">
                  <div className="backup-size-total">
                    {loading ? 'Loading...' : (backupSize?.total || '0 GB')}
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
                  <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
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
              {!loading && activities.length === 0 && (
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
