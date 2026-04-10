import { useState, useEffect } from 'react';
import { getActivities, type ActivityItem as ActivityItemType, type ActivityListParams } from '../services/activity';
import { getAudits, getAuditDetails, type AuditItem as AuditItemType, type AuditListParams, type AuditDetailsResponse } from '../services/audit';
import './Activity.css';

export default function Activity() {
  const [viewType, setViewType] = useState<'tasks' | 'audit'>('tasks');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [activities, setActivities] = useState<ActivityItemType[]>([]);
  const [audits, setAudits] = useState<AuditItemType[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedAudit, setSelectedAudit] = useState<AuditDetailsResponse | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [sortColumn, setSortColumn] = useState<string>('start');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    fetchData();
  }, [viewType, startDate, endDate]);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (viewType === 'tasks') {
        const params: ActivityListParams = {
          startDate,
          endDate,
        };
        const response = await getActivities(params);
        setActivities(response.items);
      } else {
        const params: AuditListParams = {
          startDate,
          endDate,
        };
        const response = await getAudits(params);
        setAudits(response.items);
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    try {
      if (viewType === 'tasks') {
        // TODO: Implement download for activities
        console.log('Download activities');
      } else {
        // TODO: Implement download for audits
        console.log('Download audits');
      }
    } catch (error) {
      console.error('Failed to download:', error);
    }
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

  const closeModal = () => {
    setShowModal(false);
    setSelectedAudit(null);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  };

  const getStatusIcon = (status: string) => {
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
      default:
        return <span className="status-badge">{status}</span>;
    }
  };

  return (
    <div className="activity-page">
      <div className="activity-header">
        <h2 className="page-title">Activity</h2>
        <div className="header-controls">
          <div className="date-filters">
            <div className="date-input-group">
              <label>Start date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="date-input-group">
              <label>End date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
          <button className="download-btn" onClick={handleDownload}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Download
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
          </div>
        </div>
      </div>

      <div className="activity-table-container">
        {viewType === 'tasks' ? (
          <table className="activity-table">
            <thead>
              <tr>
                <th className="sortable" onClick={() => {
                  setSortColumn('start');
                  setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                }}>
                  Start
                  {sortColumn === 'start' && (
                    <span className="sort-indicator">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </th>
                <th className="sortable" onClick={() => {
                  setSortColumn('operation');
                  setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                }}>
                  Operation
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="filter-icon">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                  </svg>
                  {sortColumn === 'operation' && (
                    <span className="sort-indicator">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </th>
                <th>Object</th>
                <th className="sortable" onClick={() => {
                  setSortColumn('status');
                  setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                }}>
                  Status
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="filter-icon">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                  </svg>
                  {sortColumn === 'status' && (
                    <span className="sort-indicator">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </th>
                <th>Finish</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="loading-cell">
                    <div className="loading-spinner" />
                  </td>
                </tr>
              ) : activities.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-cell">No activities found</td>
                </tr>
              ) : (
                activities.map((activity) => (
                  <tr key={activity.id}>
                    <td>{formatDate(activity.start_time)}</td>
                    <td>{activity.operation}</td>
                    <td>{activity.object}</td>
                    <td>{getStatusIcon(activity.status)}</td>
                    <td>{formatDate(activity.finish_time)}</td>
                    <td className="details-cell">{activity.details || ''}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : (
          <table className="audit-table">
            <thead>
              <tr>
                <th className="sortable" onClick={() => {
                  setSortColumn('date');
                  setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                }}>
                  Date
                  {sortColumn === 'date' && (
                    <span className="sort-indicator">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </th>
                <th>Actor</th>
                <th className="sortable" onClick={() => {
                  setSortColumn('operation');
                  setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                }}>
                  Operation
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="filter-icon">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                  </svg>
                  {sortColumn === 'operation' && (
                    <span className="sort-indicator">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </th>
                <th>Object</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="loading-cell">
                    <div className="loading-spinner" />
                  </td>
                </tr>
              ) : audits.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty-cell">No audit logs found</td>
                </tr>
              ) : (
                audits.map((audit) => (
                  <tr key={audit.id} onClick={() => handleAuditClick(audit)} className="clickable-row">
                    <td>{formatDate(audit.date)}</td>
                    <td className="actor-cell">
                      {audit.actor}
                      {audit.actor_email && (
                        <span className="actor-email">{audit.actor_email}</span>
                      )}
                    </td>
                    <td>{audit.operation}</td>
                    <td>{audit.object}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {showModal && selectedAudit && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="audit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <button className="modal-close" onClick={closeModal}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="modal-content">
              <div className="detail-row">
                <span className="detail-label">Operation:</span>
                <span className="detail-value">{selectedAudit.operation}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Actor:</span>
                <span className="detail-value">
                  {selectedAudit.actor}
                  {selectedAudit.actor_email && ` ${selectedAudit.actor_email}`}
                </span>
              </div>
              {selectedAudit.actor_ip && (
                <div className="detail-row">
                  <span className="detail-label">Actor IP:</span>
                  <span className="detail-value">{selectedAudit.actor_ip}</span>
                </div>
              )}
              {selectedAudit.actor_location && (
                <div className="detail-row">
                  <span className="detail-label">Actor location:</span>
                  <span className="detail-value">{selectedAudit.actor_location}</span>
                </div>
              )}
              <div className="detail-row">
                <span className="detail-label">Object:</span>
                <span className="detail-value">
                  {selectedAudit.object}
                  {selectedAudit.object_type && (
                    <span className="object-type">({selectedAudit.object_type})</span>
                  )}
                </span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Date:</span>
                <span className="detail-value">{formatDate(selectedAudit.date)}</span>
              </div>
              {selectedAudit.show_content !== undefined && (
                <div className="detail-row">
                  <span className="detail-label">Show content:</span>
                  <span className="detail-value">{selectedAudit.show_content ? 'On' : 'Off'}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
