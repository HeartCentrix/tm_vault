import { useState, useEffect } from 'react';
import './GlobalSearch.css';
import { SearchService, type SearchResult } from '../services/search';
import { RestoreModal } from '../components/RestoreModal';

type WorkloadType = 'all' | 'emails' | 'files' | 'chats' | 'channel' | 'copilot' | 'calendar' | 'contacts' | 'exchange' | 'planner';

const workloads: { key: WorkloadType; label: string; backendType?: string }[] = [
  { key: 'all', label: 'All workloads' },
  { key: 'emails', label: 'Emails', backendType: 'exchange' },
  { key: 'files', label: 'Files', backendType: 'onedrive' },
  { key: 'chats', label: 'Chats', backendType: 'teams' },
  { key: 'channel', label: 'Channel', backendType: 'teams' },
  { key: 'copilot', label: 'Copilot' },
  { key: 'calendar', label: 'Calendar', backendType: 'exchange' },
  { key: 'contacts', label: 'Contacts', backendType: 'exchange' },
  { key: 'exchange', label: 'Exchange tasks', backendType: 'exchange' },
  { key: 'planner', label: 'Planner tasks' },
];

const WORKLOAD_TO_ITEM_TYPE: Record<string, string[]> = {
  exchange: ['EMAIL', 'CALENDAR', 'CONTACT'],
  onedrive: ['FILE', 'ONEDRIVE_FILE'],
  teams: ['TEAMS_MESSAGE', 'TEAMS_MESSAGE_REPLY', 'TEAMS_CHAT_MESSAGE'],
  sharepoint: ['SHAREPOINT_FILE', 'SHAREPOINT_LIST_ITEM'],
  entra: ['ENTRA_USER_PROFILE', 'ENTRA_GROUP_META'],
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getWorkloadIcon(itemType: string): string {
  if (itemType.includes('EMAIL') || itemType.includes('CALENDAR') || itemType.includes('CONTACT')) return '📧';
  if (itemType.includes('FILE') || itemType.includes('SHAREPOINT')) return '📄';
  if (itemType.includes('TEAMS')) return '💬';
  if (itemType.includes('ENTRA')) return '👤';
  return '📦';
}

export default function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [workload, setWorkload] = useState<WorkloadType>('all');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [page, setPage] = useState(1);
  const [totalResults, setTotalResults] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Restore modal state
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<SearchResult | null>(null);

  const handleSearch = async () => {
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setHasSearched(true);
    setPage(1);

    try {
      const workloadType = workloads.find(w => w.key === workload)?.backendType;
      const response = await SearchService.search(query, {
        workloadType,
        page: 1,
        size: 20,
      });
      setResults(response.results);
      setTotalResults(response.totalResults);
      setTotalPages(response.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = async (newPage: number) => {
    setLoading(true);
    setPage(newPage);

    try {
      const workloadType = workloads.find(w => w.key === workload)?.backendType;
      const response = await SearchService.search(query, {
        workloadType,
        page: newPage,
        size: 20,
      });
      setResults(response.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const handleRecover = (item: SearchResult) => {
    setSelectedItem(item);
    setRestoreModalOpen(true);
  };

  return (
    <div className="global-search-page">
      <div className="search-bar-container">
        <div className="search-bar">
          <input
            type="text"
            placeholder="Search across all backups..."
            className="search-input-large"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            className="search-btn"
            onClick={handleSearch}
            disabled={loading || !query.trim()}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 20, height: 20}}>
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            {loading ? 'Searching...' : 'Search'}
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
        {loading && (
          <div className="loading-state">
            <div className="spinner" />
            <p>Searching across backups...</p>
          </div>
        )}

        {error && (
          <div className="error-state">
            <p>{error}</p>
          </div>
        )}

        {!loading && !error && hasSearched && results.length > 0 && (
          <>
            <div className="results-header">
              <span>{totalResults} results found</span>
            </div>

            <div className="results-table">
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Name</th>
                    <th>Source</th>
                    <th>Snapshot</th>
                    <th>Size</th>
                    <th>Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map(item => (
                    <tr key={item.id}>
                      <td>
                        <span className="item-type-icon">
                          {getWorkloadIcon(item.itemType)}
                        </span>
                        <span className="item-type-label">{item.itemType}</span>
                      </td>
                      <td className="name-cell">
                        <span className="item-name">{item.name}</span>
                        {item.preview && (
                          <span className="item-preview">{item.preview.substring(0, 100)}...</span>
                        )}
                      </td>
                      <td>
                        <div className="source-info">
                          <span className="source-name">{item.source.resourceName}</span>
                          <span className="source-tenant">{item.source.tenantName}</span>
                        </div>
                      </td>
                      <td>
                        <span className="snapshot-label">{item.snapshot.label || item.snapshot.type}</span>
                      </td>
                      <td>{formatFileSize(item.contentSize)}</td>
                      <td>{formatDate(item.createdAt)}</td>
                      <td>
                        <button
                          className="recover-btn-small"
                          onClick={() => handleRecover(item)}
                        >
                          Recover
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="pagination">
                <button
                  disabled={page <= 1}
                  onClick={() => handlePageChange(page - 1)}
                >
                  Previous
                </button>
                <span>Page {page} of {totalPages}</span>
                <button
                  disabled={page >= totalPages}
                  onClick={() => handlePageChange(page + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}

        {!loading && !error && hasSearched && results.length === 0 && (
          <div className="empty-results">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 48, height: 48, color: '#cbd5e0'}}>
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <h3>No results found</h3>
            <p>Try adjusting your search query or filters</p>
          </div>
        )}

        {!query && !hasSearched && (
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

      {/* Restore Modal */}
      {restoreModalOpen && selectedItem && (
        <RestoreModal
          isOpen={restoreModalOpen}
          onClose={() => setRestoreModalOpen(false)}
          itemIds={[selectedItem.id]}
          snapshotIds={[selectedItem.snapshotId]}
          itemName={selectedItem.name}
          itemType={selectedItem.itemType}
        />
      )}
    </div>
  );
}
