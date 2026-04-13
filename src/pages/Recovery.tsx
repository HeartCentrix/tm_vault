import { useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { getResources, type ResourceItem } from '../services/resource';
import { SnapshotService, type SnapshotItem } from '../services/snapshot';
import { RecoveryService, type RecoveryItem } from '../services/recovery';
import { usePersistentTab } from '../hooks/usePersistentTab';
import './Recovery.css';

type ContentType = 'mail' | 'onedrive' | 'contacts' | 'calendar' | 'chats';

interface MailFolder {
  id: string;
  name: string;
  count: number;
}

const CONTENT_TYPES: { key: ContentType; label: string }[] = [
  { key: 'mail', label: 'Mail' },
  { key: 'onedrive', label: 'OneDrive' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'chats', label: 'Chats' },
];

const MAIL_FOLDERS: MailFolder[] = [
  { id: 'all', name: 'All', count: 0 },
  { id: 'inbox', name: 'Inbox', count: 0 },
  { id: 'drafts', name: 'Drafts', count: 0 },
  { id: 'sent', name: 'Sent Items', count: 0 },
  { id: 'deleted', name: 'Deleted Items', count: 0 },
  { id: 'junk', name: 'Junk Email', count: 0 },
  { id: 'archive', name: 'Archive', count: 0 },
];

function formatSize(bytes: number): string {
  if (!bytes || bytes === 0) return '0 GB';
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export default function Recovery() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const resourceId = searchParams.get('resourceId');
  const snapshotParam = searchParams.get('snapshotId');

  const [resource, setResource] = useState<ResourceItem | null>(null);
  const [resourceLoading, setResourceLoading] = useState(true);
  const [noBackups, setNoBackups] = useState(false);
  const contentTabKeys = ['mail', 'onedrive', 'contacts', 'calendar', 'chats'] as const;
  const [activeContentType, setActiveContentType] = usePersistentTab<ContentType>('/recovery', 'mail', contentTabKeys);
  const [selectedFolder, setSelectedFolder] = useState<string>('all');
  const [selectedItem, setSelectedItem] = useState<RecoveryItem | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [showChanges, setShowChanges] = useState(false);

  // Snapshot selection
  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string>('');
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);

  // Recovery items
  const [recoveryItems, setRecoveryItems] = useState<RecoveryItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemCount, setItemCount] = useState(0);

  // Load resource details
  useEffect(() => {
    if (!tenantId || !resourceId) return;

    setResourceLoading(true);
    const fetchResource = async () => {
      try {
        let page = 1;
        let found: ResourceItem | undefined;
        
        while (!found) {
          const data = await getResources(tenantId, 'all', page, 100);
          found = data.items.find(r => r.id === resourceId);
          if (!found && data.items.length < 100) break;
          page++;
        }

        if (found) {
          setResource(found);
          if (!found.usage || found.usage.backups === 0) {
            setNoBackups(true);
          }
        }
      } catch (error) {
        console.error('Failed to load resource:', error);
      } finally {
        setResourceLoading(false);
      }
    };

    fetchResource();
  }, [tenantId, resourceId]);

  // Load snapshots for this resource
  useEffect(() => {
    if (!resourceId || !resource) return;
    if (noBackups) return;

    setSnapshotsLoading(true);
    SnapshotService.listByResource(resourceId, 1, 50)
      .then((data) => {
        setSnapshots(data.content);
        if (data.content.length === 0) {
          setNoBackups(true);
        } else {
          const initialSnapshot = snapshotParam && data.content.find(s => s.id === snapshotParam)
            ? snapshotParam
            : data.content[0].id;
          setSelectedSnapshotId(initialSnapshot);
        }
      })
      .catch((error) => {
        console.error('Failed to load snapshots:', error);
        setNoBackups(true);
      })
      .finally(() => setSnapshotsLoading(false));
  }, [resourceId, resource, noBackups, snapshotParam]);

  // Load items based on selected snapshot and content type
  useEffect(() => {
    if (!selectedSnapshotId || !resourceId || noBackups) return;

    setItemsLoading(true);

    RecoveryService.listItems(
      selectedSnapshotId,
      selectedFolder,
      activeContentType,
      1,
      50,
      searchQuery || undefined
    )
      .then((data) => {
        setRecoveryItems(data.content);
        setItemCount(data.totalElements);
      })
      .catch((error) => {
        console.error('Failed to load items:', error);
        setRecoveryItems([]);
        setItemCount(0);
      })
      .finally(() => setItemsLoading(false));
  }, [selectedSnapshotId, selectedFolder, activeContentType, searchQuery, resourceId, noBackups]);

  const handleSnapshotChange = (snapshotId: string) => {
    setSelectedSnapshotId(snapshotId);
    setSelectedItem(null);
    setSelectedItems(new Set());
  };

  const toggleSelectItem = (itemId: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const handleRecover = () => {
    if (!selectedSnapshotId || selectedItems.size === 0) return;
    
    RecoveryService.triggerRecovery({
      restoreType: 'IN_PLACE',
      snapshotIds: [selectedSnapshotId],
      itemIds: Array.from(selectedItems),
    })
      .then((response) => {
        console.log('Recovery job created:', response.jobId);
        // TODO: Show success notification
      })
      .catch(console.error);
  };

  const handleDownload = () => {
    if (!selectedSnapshotId || selectedItems.size === 0) return;
    
    RecoveryService.triggerExport({
      restoreType: 'EXPORT_ZIP',
      snapshotIds: [selectedSnapshotId],
      itemIds: Array.from(selectedItems),
    })
      .then((response) => {
        console.log('Export job created:', response.jobId);
        // TODO: Show success notification and provide download link
      })
      .catch(console.error);
  };

  // Loading state
  if (resourceLoading) {
    return (
      <div className="recovery-page">
        <div className="loading-container">
          <div className="spinner" />
          <p>Loading recovery data...</p>
        </div>
      </div>
    );
  }

  // Resource not found
  if (!resource) {
    return (
      <div className="recovery-page">
        <div className="loading-container">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 48, height: 48, color: '#94a3b8' }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p>Resource not found</p>
          <button className="action-button recover" onClick={() => navigate(-1)} style={{ marginTop: 16 }}>
            Go Back
          </button>
        </div>
      </div>
    );
  }

  // No backups available
  if (noBackups) {
    return (
      <div className="recovery-page">
        <div className="loading-container">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 48, height: 48, color: '#94a3b8' }}>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <line x1="2" y1="2" x2="22" y2="22" stroke="#94a3b8" strokeWidth="2" />
          </svg>
          <p style={{ marginTop: 16, fontSize: 16, fontWeight: 600, color: '#0f172a' }}>No backups available</p>
          <p style={{ color: '#64748b', marginBottom: 24, textAlign: 'center' }}>
            This resource has not been backed up yet.<br />
            Please run a backup first from the Protection page.
          </p>
          <button className="action-button recover" onClick={() => navigate(-1)}>
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="recovery-page">
      {/* Header Section */}
      <div className="recovery-header">
        <div className="header-left">
          <div className="resource-avatar">{resource.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}</div>
          <div className="resource-info">
            <div className="resource-name">{resource.name}</div>
            {resource.email && <div className="resource-email">{resource.email}</div>}
          </div>
          {resource.last_backup && (
            <div className="last-backup-info">
              <span className="label">Last backup:</span>
              <span className="value">{new Date(resource.last_backup).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}, {new Date(resource.last_backup).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</span>
            </div>
          )}
        </div>
        
        <div className="header-stats">
          <div className="stats-box">
            <div className="stats-label">Backup size</div>
            <div className="stats-value">{formatSize(resource.usage?.size || 0)}</div>
            <div className="stats-bar-container">
              <div className="stats-bar" style={{ width: `${Math.min(100, (resource.usage?.size || 0) / 4294967296 * 100)}%` }}></div>
            </div>
            <div className="stats-legend">
              <div>1w <span>+{formatSize(resource.usage?.size_delta_week || 0)}</span></div>
              <div>1m <span>+{formatSize(resource.usage?.size_delta_month || 0)}</span></div>
              <div>1y <span>+{formatSize(resource.usage?.size_delta_year || 0)}</span></div>
            </div>
          </div>
          
          <div className="backup-version-selector">
            <label>Backup version</label>
            <select
              value={selectedSnapshotId}
              onChange={(e) => handleSnapshotChange(e.target.value)}
              disabled={snapshotsLoading}
            >
              {snapshotsLoading && <option>Loading...</option>}
              {snapshots.map(snapshot => (
                <option key={snapshot.id} value={snapshot.id}>
                  {new Date(snapshot.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Content Type Tabs */}
      <div className="content-type-tabs">
        {CONTENT_TYPES.map(tab => (
          <button
            key={tab.key}
            className={`content-tab ${activeContentType === tab.key ? 'active' : ''}`}
            onClick={() => setActiveContentType(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Content Area */}
      <div className="recovery-content">
        {/* Toolbar */}
        <div className="recovery-toolbar">
          <div className="toolbar-left">
            <button
              className={`filter-toggle ${!showChanges ? 'active' : ''}`}
              onClick={() => setShowChanges(false)}
            >
              All
            </button>
            <button
              className={`filter-toggle ${showChanges ? 'active' : ''}`}
              onClick={() => setShowChanges(true)}
            >
              Changes
            </button>
            <div className="search-wrapper">
              <input
                type="text"
                placeholder="Search"
                className="search-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <button className="search-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}>
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </button>
            </div>
          </div>
          
          <div className="toolbar-right">
            <button 
              className="action-button download" 
              onClick={handleDownload}
              disabled={selectedItems.size === 0}
            >
              Download{selectedItems.size > 0 ? ` (${selectedItems.size})` : ''}
            </button>
            <button 
              className="action-button recover" 
              onClick={handleRecover}
              disabled={selectedItems.size === 0}
            >
              Recover{selectedItems.size > 0 ? ` (${selectedItems.size})` : ''}
            </button>
          </div>
        </div>

        {/* Three Panel Layout */}
        <div className="three-panel-layout">
          {/* Left Panel: Folder Tree */}
          <div className="panel-left">
            <div className="folder-list">
              {MAIL_FOLDERS.map(folder => (
                <button
                  key={folder.id}
                  className={`folder-item ${selectedFolder === folder.id ? 'active' : ''}`}
                  onClick={() => setSelectedFolder(folder.id)}
                >
                  <span className="folder-name">{folder.name}</span>
                  {folder.count > 0 && <span className="folder-count">{folder.count}</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Middle Panel: Item List */}
          <div className="panel-middle">
            <div className="item-list-header">
              <span className="item-count">Items: {itemCount}</span>
              <div className="sort-controls">
                <span>Sort by: Date</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
            </div>
            
            <div className="item-list">
              {itemsLoading ? (
                <div className="loading-container">
                  <div className="spinner" />
                  <p>Loading items...</p>
                </div>
              ) : recoveryItems.length === 0 ? (
                <div className="empty-state">
                  <p>No items found</p>
                </div>
              ) : (
                recoveryItems.map(item => (
                  <div
                    key={item.id}
                    className={`item-row ${selectedItem?.id === item.id ? 'selected' : ''}`}
                    onClick={() => setSelectedItem(item)}
                  >
                    <input
                      type="checkbox"
                      checked={selectedItems.has(item.id)}
                      onChange={() => toggleSelectItem(item.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="item-content">
                      <div className="item-subject">{item.subject || item.name}</div>
                      <div className="item-preview">{item.preview || ''}</div>
                    </div>
                    <div className="item-date">{item.date ? new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right Panel: Item Preview */}
          <div className="panel-right">
            {selectedItem ? (
              <div className="item-preview">
                <div className="preview-header">
                  {selectedItem.from && (
                    <div className="preview-from">
                      <span className="label">From:</span>
                      <span className="value">{selectedItem.from}</span>
                    </div>
                  )}
                  {selectedItem.to && (
                    <div className="preview-to">
                      <span className="label">To:</span>
                      <span className="value">{selectedItem.to}</span>
                    </div>
                  )}
                  <div className="preview-status">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14, color: '#38a169' }}>
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    {selectedItem.subject || selectedItem.name}
                  </div>
                  {selectedItem.date && (
                    <div className="preview-date">{new Date(selectedItem.date).toLocaleString()}</div>
                  )}
                </div>
                
                <div className="preview-body">
                  <p>{selectedItem.body || selectedItem.preview || 'No content available'}</p>
                </div>
              </div>
            ) : (
              <div className="empty-preview">
                <p>Select an item to preview</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
