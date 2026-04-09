import { useState } from 'react';
import './Overview.css';

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

const mock24HourStatus: StatusCard = { label: 'Last 24 hours', value: '98.5%', change: '+0.3%', positive: true };
const mock7DayStatus: StatusCard = { label: 'Last 7 days', value: '97.2%', change: '+1.1%', positive: true };
const mockProtection: StatusCard = { label: 'Protected', value: '1,247 / 1,280' };
const mockBackupSize: StatusCard = { label: 'Backup Size', value: '2.4 TB' };

const mockActivities: ActivityItem[] = [
  { id: '1', tenant: 'Contoso M365', type: 'Full Backup', status: 'Done', time: '2 min ago' },
  { id: '2', tenant: 'Fabrikam Azure', type: 'Incremental', status: 'In Progress', time: '5 min ago' },
  { id: '3', tenant: 'Contoso M365', type: 'Full Backup', status: 'Done', time: '1 hour ago' },
  { id: '4', tenant: 'Contoso M365', type: 'Snapshot', status: 'Failed', time: '3 hours ago' },
  { id: '5', tenant: 'Fabrikam Azure', type: 'Incremental', status: 'Done', time: '6 hours ago' },
];

// Simple bar chart data
const backupSizeData = [
  { day: 'Mon', size: 340 },
  { day: 'Tue', size: 280 },
  { day: 'Wed', size: 420 },
  { day: 'Thu', size: 380 },
  { day: 'Fri', size: 310 },
  { day: 'Sat', size: 250 },
  { day: 'Sun', size: 290 },
];

export default function Overview() {
  const maxBackupSize = Math.max(...backupSizeData.map(d => d.size));

  return (
    <div className="overview-page">
      <div className="status-cards">
        {/* 24-hour status */}
        <div className="status-card">
          <div className="status-card-header">
            <span className="status-label">{mock24HourStatus.label}</span>
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
              <span className="progress-value">98.5%</span>
            </div>
          </div>
          {mock24HourStatus.change && (
            <div className={`status-change ${mock24HourStatus.positive ? 'positive' : 'negative'}`}>
              {mock24HourStatus.change} from previous
            </div>
          )}
        </div>

        {/* 7-day status */}
        <div className="status-card">
          <div className="status-card-header">
            <span className="status-label">{mock7DayStatus.label}</span>
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
              <span className="progress-value">97.2%</span>
            </div>
          </div>
          {mock7DayStatus.change && (
            <div className={`status-change ${mock7DayStatus.positive ? 'positive' : 'negative'}`}>
              {mock7DayStatus.change} from previous
            </div>
          )}
        </div>

        {/* Protection status */}
        <div className="status-card">
          <div className="status-card-header">
            <span className="status-label">{mockProtection.label}</span>
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
                  strokeDashoffset={`${2 * Math.PI * 34 * (1 - 1247/1280)}`}
                  strokeLinecap="round"
                  transform="rotate(-90 40 40)"
                />
              </svg>
              <span className="progress-value">{Math.round(1247/1280*100)}%</span>
            </div>
          </div>
          <div className="status-detail">1,247 of 1,280 resources protected</div>
        </div>

        {/* Backup size */}
        <div className="status-card">
          <div className="status-card-header">
            <span className="status-label">{mockBackupSize.label}</span>
          </div>
          <div className="status-card-value">
            <div className="backup-size-value">
              <span className="backup-size-text">2.4 TB</span>
            </div>
          </div>
          {/* Bar chart */}
          <div className="bar-chart">
            <div className="bar-chart-y-axis">
              <span className="y-tick">{maxBackupSize}GB</span>
              <span className="y-tick">{Math.round(maxBackupSize/2)}GB</span>
              <span className="y-tick">0</span>
            </div>
            <div className="bar-chart-bars">
              {backupSizeData.map((d) => (
                <div key={d.day} className="bar-chart-column">
                  <div
                    className="bar-chart-bar"
                    style={{ height: `${(d.size / maxBackupSize) * 100}%` }}
                  />
                  <span className="bar-chart-label">{d.day}</span>
                </div>
              ))}
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
