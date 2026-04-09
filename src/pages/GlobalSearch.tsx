import { useState } from 'react';
import './GlobalSearch.css';

type WorkloadType = 'all' | 'emails' | 'files' | 'chats' | 'channel' | 'copilot' | 'calendar' | 'contacts' | 'exchange' | 'planner';

const workloads: { key: WorkloadType; label: string }[] = [
  { key: 'all', label: 'All workloads' },
  { key: 'emails', label: 'Emails' },
  { key: 'files', label: 'Files' },
  { key: 'chats', label: 'Chats' },
  { key: 'channel', label: 'Channel' },
  { key: 'copilot', label: 'Copilot' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'exchange', label: 'Exchange tasks' },
  { key: 'planner', label: 'Planner tasks' },
];

export default function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [workload, setWorkload] = useState<WorkloadType>('all');

  return (
    <div className="global-search-page">
      <div className="global-search-header">
        <h1 className="page-title">Global Search</h1>
      </div>

      <div className="search-bar-container">
        <div className="search-bar">
          <input
            type="text"
            placeholder="Search across all backups..."
            className="search-input-large"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="search-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 20, height: 20}}>
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            Search
          </button>
        </div>

        <div className="search-filters">
          <div className="filter-group">
            <label className="filter-label">Workload</label>
            <select
              className="filter-select"
              value={workload}
              onChange={(e) => setWorkload(e.target.value as WorkloadType)}
            >
              {workloads.map(w => (
                <option key={w.key} value={w.key}>{w.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="search-results">
        {!query && (
          <div className="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 64, height: 64, color: '#cbd5e0'}}>
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <h3 className="empty-state-title">Launch a search query to start</h3>
            <p className="empty-state-text">Search across all your backed up data to find and recover items</p>
          </div>
        )}
      </div>
    </div>
  );
}
