import { useState } from 'react';
import './Activity.css';

interface ActivityItem {
  id: string;
  tenant: string;
  type: string;
  status: 'Done' | 'In Progress' | 'Failed';
  startTime: string;
  duration: string;
}

const mockActivities: ActivityItem[] = [
  { id: '1', tenant: 'Contoso M365', type: 'Full Backup', status: 'Done', startTime: '2024-01-15 10:00', duration: '15 min' },
  { id: '2', tenant: 'Fabrikam Azure', type: 'Incremental', status: 'In Progress', startTime: '2024-01-15 10:05', duration: '-' },
  { id: '3', tenant: 'Contoso M365', type: 'Full Backup', status: 'Done', startTime: '2024-01-15 09:00', duration: '12 min' },
  { id: '4', tenant: 'Contoso M365', type: 'Snapshot', status: 'Failed', startTime: '2024-01-15 07:00', duration: '2 min' },
  { id: '5', tenant: 'Fabrikam Azure', type: 'Incremental', status: 'Done', startTime: '2024-01-15 04:00', duration: '8 min' },
];

export default function Activity() {
  const [viewType, setViewType] = useState<'jobs' | 'audit'>('jobs');
  const [filterUnresolved, setFilterUnresolved] = useState(false);

  const filteredActivities = filterUnresolved
    ? mockActivities.filter(a => a.status === 'Failed')
    : mockActivities;

  return (
    <div className="activity-page">
      <div className="activity-header">
        <div className="view-toggle">
          <button
            className={`toggle-btn ${viewType === 'jobs' ? 'active' : ''}`}
            onClick={() => setViewType('jobs')}
          >
            Jobs
          </button>
          <button
            className={`toggle-btn ${viewType === 'audit' ? 'active' : ''}`}
            onClick={() => setViewType('audit')}
          >
            Audit
          </button>
        </div>
      </div>

      <div className="activity-filters">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={filterUnresolved}
            onChange={(e) => setFilterUnresolved(e.target.checked)}
          />
          Show unresolved only
        </label>
        <button className="download-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 16, height: 16}}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download CSV
        </button>
      </div>

      <div className="activity-table-container">
        <table className="activity-table">
          <thead>
            <tr>
              <th>Tenant</th>
              <th>Type</th>
              <th>Status</th>
              <th>Start Time</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {filteredActivities.map((activity) => (
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
                <td className="text-muted">{activity.startTime}</td>
                <td>{activity.duration}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
