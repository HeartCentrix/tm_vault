import { useEffect, useState } from 'react';
import './Overview.css';
import { API } from '../config/api';

interface StatusCard {
  label: string;
  value: string;
  change?: string;
  positive?: boolean;
}

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

function getDayName(dateStr: string): string {
  const date = new Date(dateStr);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[date.getDay()];
}

function formatBytesToDisplay(bytes: number): { value: number; unit: string } {
  if (bytes >= 1024 * 1024 * 1024) {
    return { value: Math.round(bytes / (1024 * 1024 * 1024)), unit: 'GB' };
  } else if (bytes >= 1024 * 1024) {
    return { value: Math.round(bytes / (1024 * 1024)), unit: 'MB' };
  } else if (bytes >= 1024) {
    return { value: Math.round(bytes / 1024), unit: 'KB' };
  }
  return { value: bytes, unit: 'B' };
}

function formatBytesToGB(bytes: number): number {
  // Return decimal GB for accurate graph scaling
  return bytes / (1024 * 1024 * 1024);
}

export default function Overview() {
  const [backupSize, setBackupSize] = useState<BackupSizeResponse | null>(null);
  const [protection, setProtection] = useState<ProtectionStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    Promise.all([
      fetch(API.DASHBOARD.BACKUP_SIZE, { headers }).then(r => r.json()),
      fetch(API.DASHBOARD.PROTECTION, { headers }).then(r => r.json()),
    ])
      .then(([backupData, protectionData]) => {
        setBackupSize(backupData);
        setProtection(protectionData);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const maxBackupSize = backupSize?.dailyData 
    ? Math.max(...backupSize.dailyData.map(d => formatBytesToGB(d.bytes)))
    : 0;

  return (
    <div className="overview-page">
      <div className="status-cards">
        {/* 24-hour status */}
        <div className="status-card">
          <div className="status-card-header">
            <span className="status-label">Last 24 hours</span>
          </div>
          <div className="status-card-value">
            <div className="progress-ring-container">
              <svg className="progress-ring" width="80" height="80">
                <circle
                  className="progress-ring-bg"
                  cx="40" cy="40" r="34"
                  fill="none"
                  stroke="#e2e8f0"
                  strokeWidth="6"
                />
                <circle
                  className="progress-ring-progress"
                  cx="40" cy="40" r="34"
                  fill="none"
                  stroke="#38a169"
                  strokeWidth="6"
                  strokeDasharray={`${2 * Math.PI * 34}`}
                  strokeDashoffset={`${2 * Math.PI * 34 * (1 - 0.985)}`}
                  strokeLinecap="round"
                  transform="rotate(-90 40 40)"
                />
              </svg>
              <span className="progress-value">{loading ? '...' : '98.5%'}</span>
            </div>
          </div>
        </div>

        {/* 7-day status */}
        <div className="status-card">
          <div className="status-card-header">
            <span className="status-label">Last 7 days</span>
          </div>
          <div className="status-card-value">
            <div className="progress-ring-container">
              <svg className="progress-ring" width="80" height="80">
                <circle
                  className="progress-ring-bg"
                  cx="40" cy="40" r="34"
                  fill="none"
                  stroke="#e2e8f0"
                  strokeWidth="6"
                />
                <circle
                  className="progress-ring-progress"
                  cx="40" cy="40" r="34"
                  fill="none"
                  stroke="#38a169"
                  strokeWidth="6"
                  strokeDasharray={`${2 * Math.PI * 34}`}
                  strokeDashoffset={`${2 * Math.PI * 34 * (1 - 0.972)}`}
                  strokeLinecap="round"
                  transform="rotate(-90 40 40)"
                />
              </svg>
              <span className="progress-value">{loading ? '...' : '97.2%'}</span>
            </div>
          </div>
        </div>

        {/* Protection status */}
        <div className="status-card">
          <div className="status-card-header">
            <span className="status-label">Protected</span>
          </div>
          <div className="status-card-value">
            <div className="progress-ring-container">
              <svg className="progress-ring" width="80" height="80">
                <circle
                  className="progress-ring-bg"
                  cx="40" cy="40" r="34"
                  fill="none"
                  stroke="#e2e8f0"
                  strokeWidth="6"
                />
                <circle
                  className="progress-ring-progress"
                  cx="40" cy="40" r="34"
                  fill="none"
                  stroke="#38a169"
                  strokeWidth="6"
                  strokeDasharray={`${2 * Math.PI * 34}`}
                  strokeDashoffset={
                    protection && protection.totalCount > 0
                      ? `${2 * Math.PI * 34 * (1 - protection.percentage / 100)}`
                      : `${2 * Math.PI * 34}`
                  }
                  strokeLinecap="round"
                  transform="rotate(-90 40 40)"
                />
              </svg>
              <span className="progress-value">
                {loading ? '...' : (protection ? `${Math.round(protection.percentage)}%` : '0%')}
              </span>
            </div>
          </div>
          <div className="status-detail">
            {loading 
              ? 'Loading...' 
              : protection 
                ? (() => {
                    const totals = calculateProtectionTotals(protection);
                    return `${totals.protectedCount} of ${totals.totalCount} resources protected`;
                  })()
                : '0 of 0 resources protected'}
          </div>
        </div>

        {/* Backup size */}
        <div className="status-card">
          <div className="status-card-header">
            <span className="status-label">Backup Size</span>
          </div>
          <div className="status-card-value">
            <div className="backup-size-value">
              <span className="backup-size-text">
                {loading ? 'Loading...' : (backupSize?.total || '0 B')}
              </span>
            </div>
          </div>
          {backupSize?.oneDayChange && (
            <div className="status-detail" style={{ textAlign: 'center', marginTop: 4, fontSize: 12, color: '#94a3b8' }}>
              {backupSize.oneDayChange} from yesterday
            </div>
          )}
          {/* Bar chart */}
          {backupSize?.dailyData && backupSize.dailyData.length > 0 && (
            <div className="bar-chart">
              <div className="bar-chart-y-axis">
                {(() => {
                  const maxData = formatBytesToDisplay(maxBackupSize * 1024 * 1024 * 1024);
                  const halfData = formatBytesToDisplay((maxBackupSize / 2) * 1024 * 1024 * 1024);
                  return (
                    <>
                      <span className="y-tick">{maxData.value}{maxData.unit}</span>
                      <span className="y-tick">{halfData.value}{halfData.unit}</span>
                      <span className="y-tick">0</span>
                    </>
                  );
                })()}
              </div>
              <div className="bar-chart-bars">
                {backupSize.dailyData.slice(-7).map((d) => {
                  const sizeGB = formatBytesToGB(d.bytes);
                  const displaySize = formatBytesToDisplay(d.bytes);
                  return (
                    <div key={d.date} className="bar-chart-column">
                      <div
                        className="bar-chart-bar"
                        style={{ 
                          height: `${maxBackupSize > 0 ? (sizeGB / maxBackupSize) * 100 : (d.bytes > 0 ? 10 : 0)}%`,
                          minHeight: d.bytes > 0 ? '4px' : '0'
                        }}
                        title={`${displaySize.value} ${displaySize.unit}`}
                      />
                      <span className="bar-chart-label">{getDayName(d.date)}</span>
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
