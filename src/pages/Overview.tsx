import { useEffect, useState } from 'react';
import './Overview.css';
import { API } from '../config/api';

interface ActivityItem {
  id: string;
  tenant: string;
  type: string;
  status: 'Done' | 'In Progress' | 'Failed';
  time: string;
}

interface BackupSizeResponse {
  total: string;
  oneDayChange: string;
  oneMonthChange: string;
  oneYearChange: string;
  dailyData: { date: string; bytes: number }[];
}

interface ProtectionStatus {
  percentage: number;
  users: { protectedCount: number; total: number };
  sharedMailboxes: { protectedCount: number; total: number };
  rooms: { protectedCount: number; total: number };
  sharepointSites: { protectedCount: number; total: number };
  groupsAndTeams: { protectedCount: number; total: number };
  entraId: { protectedCount: number; total: number };
  powerPlatform: { protectedCount: number; total: number };
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

function calculateProtectionTotals(data: ProtectionStatus): { protectedCount: number; totalCount: number; percentage: number } {
  const allCategories = [
    data.users,
    data.sharedMailboxes,
    data.rooms,
    data.sharepointSites,
    data.groupsAndTeams,
    data.entraId,
    data.powerPlatform,
  ];

  const totalCount = allCategories.reduce((sum, cat) => sum + cat.total, 0);
  const protectedCount = allCategories.reduce((sum, cat) => sum + cat.protectedCount, 0);
  const percentage = totalCount > 0 ? (protectedCount / totalCount) * 100 : 0;

  return { protectedCount, totalCount, percentage };
}

const mockActivities: ActivityItem[] = [
  { id: '1', tenant: 'Contoso M365', type: 'Full Backup', status: 'Done', time: '2 min ago' },
  { id: '2', tenant: 'Fabrikam Azure', type: 'Incremental', status: 'In Progress', time: '5 min ago' },
  { id: '3', tenant: 'Contoso M365', type: 'Full Backup', status: 'Done', time: '1 hour ago' },
  { id: '4', tenant: 'Contoso M365', type: 'Snapshot', status: 'Failed', time: '3 hours ago' },
  { id: '5', tenant: 'Fabrikam Azure', type: 'Incremental', status: 'Done', time: '6 hours ago' },
];

function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr);
  return `Apr ${date.getDate()}`;
}

function formatBytesToGB(bytes: number): number {
  return bytes / (1024 * 1024 * 1024);
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

export default function Overview() {
  const [backupSize, setBackupSize] = useState<BackupSizeResponse | null>(null);
  const [protection, setProtection] = useState<ProtectionStatus | null>(null);
  const [status24h, setStatus24h] = useState<Status24hResponse | null>(null);
  const [status7d, setStatus7d] = useState<Status7dResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

    Promise.all([
      fetch(API.DASHBOARD.BACKUP_SIZE, { headers }).then(r => r.json()),
      fetch(API.DASHBOARD.PROTECTION, { headers }).then(r => r.json()),
      fetch(API.DASHBOARD.STATUS_24H, { headers }).then(r => r.json()),
      fetch(API.DASHBOARD.STATUS_7D, { headers }).then(r => r.json()),
    ])
      .then(([backupData, protectionData, data24h, data7d]) => {
        setBackupSize(backupData);
        setProtection(protectionData);
        setStatus24h(data24h);
        setStatus7d(data7d);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const maxBackupSize = backupSize?.dailyData
    ? Math.max(...backupSize.dailyData.map(d => formatBytesToGB(d.bytes)), 0.1)
    : 0.1;

  const hasFailures24h = (status24h?.failures || 0) > 0;

  const maxDailyBackups = status7d?.dailyStatus.length
    ? Math.max(...status7d.dailyStatus.map(d => d.success + d.failures), 1)
    : 1;

  return (
    <div className="overview-page">
      <div className="status-cards">
        {/* 24-hour status */}
        <div className="status-card">
          <div className="status-card-header">
            <span className="status-label">24-hour status</span>
          </div>
          <div className="status-card-value">
            {loading ? (
              <span style={{ color: '#94a3b8' }}>Loading...</span>
            ) : (
              <div style={{ textAlign: 'center', width: '100%' }}>
                <div style={{ fontSize: 32, fontWeight: 700, color: hasFailures24h ? '#dc2626' : '#059669' }}>
                  {hasFailures24h ? 'Failures' : 'Success'}
                </div>
                <div style={{ fontSize: 13, color: '#64748b', marginTop: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                    <span style={{ color: '#059669' }}>✓ Success</span>
                    <span>{status24h?.success || 0}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                    <span style={{ color: '#dc2626' }}>✗ Failures</span>
                    <span>{status24h?.failures || 0}</span>
                  </div>
                </div>
                <button className="backup-all-btn" style={{ marginTop: 12 }}>
                  Backup all now
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 7-day status */}
        <div className="status-card">
          <div className="status-card-header">
            <span className="status-label">7-day status</span>
          </div>
          <div className="status-card-value">
            {loading ? (
              <span style={{ color: '#94a3b8' }}>Loading...</span>
            ) : (
              <div style={{ width: '100%' }}>
                {/* Legend */}
                <div style={{ display: 'flex', gap: 16, fontSize: 12, marginBottom: 8 }}>
                  <span style={{ color: '#059669' }}>✓ Success {status7d?.summary.totalBackups || 0}</span>
                  <span style={{ color: '#f59e0b' }}>⚠ Warnings 0</span>
                  <span style={{ color: '#dc2626' }}>✗ Failures {(status7d?.dailyStatus || []).reduce((s, d) => s + d.failures, 0)}</span>
                </div>
                {/* Bar chart */}
                <div style={{ position: 'relative', height: 100, marginTop: 8 }}>
                  {/* Y-axis labels */}
                  <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontSize: 10, color: '#94a3b8' }}>
                    <span>{maxDailyBackups}</span>
                    <span>{Math.round(maxDailyBackups / 2)}</span>
                    <span>0</span>
                  </div>
                  {/* Bars */}
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, marginLeft: 30, height: '100%', paddingBottom: 24 }}>
                    {status7d?.dailyStatus.slice(-7).map((d) => {
                      const successH = maxDailyBackups > 0 ? (d.success / maxDailyBackups) * 100 : 0;
                      const failH = maxDailyBackups > 0 ? (d.failures / maxDailyBackups) * 100 : 0;
                      return (
                        <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                            {d.failures > 0 && (
                              <div style={{ backgroundColor: '#fb7185', height: `${failH}%`, minHeight: d.failures > 0 ? 4 : 0, borderRadius: '2px 2px 0 0' }} />
                            )}
                            <div style={{ backgroundColor: d.failures > 0 ? '#059669' : '#14b8a6', height: `${successH}%`, minHeight: d.success > 0 ? 4 : 0, borderRadius: d.failures > 0 ? '0' : '2px 2px 0 0' }} />
                          </div>
                          <span style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>{formatDateShort(d.date)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Protection status */}
        <div className="status-card">
          <div className="status-card-header">
            <span className="status-label">Protection status</span>
          </div>
          <div className="status-card-value">
            {loading ? (
              <span style={{ color: '#94a3b8' }}>Loading...</span>
            ) : (() => {
              const totals = protection ? calculateProtectionTotals(protection) : { protectedCount: 0, totalCount: 0, percentage: 0 };
              return (
                <div style={{ width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: 32, fontWeight: 700, color: '#0d9488' }}>
                      {totals.totalCount > 0 ? `${Math.round(totals.percentage)}%` : '0%'}
                    </div>
                    {/* Mini donut */}
                    <svg width="40" height="40" style={{ transform: 'rotate(-90deg)' }}>
                      <circle cx="20" cy="20" r="16" fill="none" stroke="#e2e8f0" strokeWidth="4" />
                      <circle cx="20" cy="20" r="16" fill="none" stroke="#0d9488" strokeWidth="4"
                        strokeDasharray={`${2 * Math.PI * 16}`}
                        strokeDashoffset={`${2 * Math.PI * 16 * (1 - totals.percentage / 100)}`}
                        strokeLinecap="round" />
                    </svg>
                  </div>
                  {/* Granular breakdown */}
                  {protection && (
                    <div style={{ marginTop: 12, fontSize: 12, color: '#64748b', lineHeight: 1.8 }}>
                      {protection.users.total > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Users</span>
                          <span style={{ color: '#f59e0b' }}>{protection.users.protectedCount} / {protection.users.total}</span>
                        </div>
                      )}
                      {protection.sharedMailboxes.total > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Shared mailboxes</span>
                          <span>{protection.sharedMailboxes.protectedCount} / {protection.sharedMailboxes.total}</span>
                        </div>
                      )}
                      {protection.rooms.total > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Rooms</span>
                          <span>{protection.rooms.protectedCount} / {protection.rooms.total}</span>
                        </div>
                      )}
                      {protection.sharepointSites.total > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>SharePoint sites</span>
                          <span style={{ color: '#f59e0b' }}>{protection.sharepointSites.protectedCount} / {protection.sharepointSites.total}</span>
                        </div>
                      )}
                      {protection.groupsAndTeams.total > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Groups & Teams</span>
                          <span style={{ color: '#f59e0b' }}>{protection.groupsAndTeams.protectedCount} / {protection.groupsAndTeams.total}</span>
                        </div>
                      )}
                      {protection.entraId.total > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Entra ID</span>
                          <span>{protection.entraId.protectedCount} / {protection.entraId.total}</span>
                        </div>
                      )}
                      {protection.powerPlatform.total > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Power Platform</span>
                          <span>{protection.powerPlatform.protectedCount} / {protection.powerPlatform.total}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Backup size */}
        <div className="status-card">
          <div className="status-card-header">
            <span className="status-label">Backup size</span>
          </div>
          <div className="status-card-value">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 32, fontWeight: 700, color: '#0f172a' }}>
                  {loading ? 'Loading...' : (backupSize?.total || '0 GB')}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, fontSize: 10 }}>
                {backupSize?.oneMonthChange && (
                  <div style={{ backgroundColor: '#f0fdf4', padding: '4px 8px', borderRadius: 4, color: '#16a34a' }}>
                    7 days<br />{backupSize.oneMonthChange}
                  </div>
                )}
                {backupSize?.oneYearChange && (
                  <div style={{ backgroundColor: '#f8fafc', padding: '4px 8px', borderRadius: 4, color: '#64748b' }}>
                    All time<br />{backupSize.oneYearChange}
                  </div>
                )}
              </div>
            </div>
          </div>
          {/* Bar chart */}
          {backupSize?.dailyData && backupSize.dailyData.length > 0 && (
            <div style={{ marginTop: 8, position: 'relative', height: 100 }}>
              <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontSize: 10, color: '#94a3b8' }}>
                <span>{formatGB(maxBackupSize * 1024 * 1024 * 1024)}</span>
                <span>{formatGB((maxBackupSize / 2) * 1024 * 1024 * 1024)}</span>
                <span>0 GB</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, marginLeft: 35, height: '100%', paddingBottom: 24 }}>
                {backupSize.dailyData.slice(-7).map((d) => {
                  const sizeGB = formatBytesToGB(d.bytes);
                  const pct = maxBackupSize > 0 ? (sizeGB / maxBackupSize) * 100 : 0;
                  return (
                    <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div style={{ width: '100%', backgroundColor: '#14b8a6', height: `${Math.max(pct, d.bytes > 0 ? 3 : 0)}%`, minHeight: d.bytes > 0 ? 6 : 0, borderRadius: '2px 2px 0 0', transition: 'height 0.3s' }}
                           title={formatGB(d.bytes)} />
                      <span style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>{formatDateShort(d.date)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Activity Table */}
      <div className="activity-section">
        <h2 className="activity-title">Recent Activity</h2>
        <div className="activity-table-container">
          <table className="activity-table">
            <thead>
              <tr>
                <th>Tenant</th>
                <th>Type</th>
                <th>Status</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {mockActivities.map((activity) => (
                <tr key={activity.id}>
                  <td className="activity-tenant">{activity.tenant}</td>
                  <td>{activity.type}</td>
                  <td>
                    <span className={`activity-status ${
                      activity.status === 'Done' ? 'done' :
                      activity.status === 'In Progress' ? 'in-progress' : 'failed'
                    }`}>
                      {activity.status === 'In Progress' && <span className="spinner-small" />}
                      {activity.status}
                    </span>
                  </td>
                  <td className="text-muted">{activity.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
