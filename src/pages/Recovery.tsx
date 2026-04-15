import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { SnapshotService, type SnapshotItem, type SnapshotFolder, type ResourceWithBackups } from '../services/snapshot';
import { RecoveryService, type RecoveryItem } from '../services/recovery';
import { RestoreModal } from '../components/RestoreModal';
import './Recovery.css';

type ContentType = string;

function formatContentTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    'USER_PROFILE': 'User Profile',
    'ONEDRIVE': 'OneDrive',
    'POWER_BI_WORKSPACE': 'Workspace Metadata',
    'POWER_BI_REPORT': 'Reports',
    'POWER_BI_PAGINATED_REPORT': 'Paginated Reports',
    'POWER_BI_SEMANTIC_MODEL': 'Semantic Models',
    'POWER_BI_DATAFLOW': 'Dataflows',
    'POWER_BI_DASHBOARD': 'Dashboards',
    'POWER_BI_TILE': 'Dashboard Tiles',
    'POWER_BI_DATASOURCE': 'Datasource Metadata',
    'POWER_BI_REFRESH_SCHEDULE': 'Refresh Schedules',
    'POWER_BI_PERMISSIONS': 'Permissions',
    'POWER_BI_LINEAGE': 'Lineage',
  };
  
  if (labels[type]) return labels[type];
  
  // Convert to title case: replace underscores with spaces, capitalize first letter, lowercase rest
  return type
    .replace(/_/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function formatSize(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  if (bytes >= 1099511627776) return `${(bytes / 1099511627776).toFixed(1)} TB`;
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function getKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    office_user: 'User',
    shared_mailbox: 'Shared mailbox',
    room_mailbox: 'Room',
    onedrive: 'OneDrive',
    sharepoint_site: 'SharePoint',
    teams_channel: 'Teams channel',
    teams_chat: 'Teams chat',
    power_bi: 'Power BI workspace',
    azure_vm: 'Azure VM',
    azure_sql: 'Azure SQL',
    azure_postgresql: 'Azure PostgreSQL',
  };
  return labels[kind] || kind;
}

export default function Recovery() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  
  // Dynamic content types from snapshot items
  const [contentTypes, setContentTypes] = useState<ContentType[]>([]);
  const [contentTypesLoading, setContentTypesLoading] = useState(false);
  const [activeContentType, setActiveContentType] = useState<ContentType>('');

  // Resource selection
  const [resources, setResources] = useState<ResourceWithBackups[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(true);
  const [resourceSearch, setResourceSearch] = useState('');
  const [selectedResource, setSelectedResource] = useState<ResourceWithBackups | null>(null);

  // Snapshot selection
  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string>('');
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);

  // Folders (real from snapshot items)
  const [folders, setFolders] = useState<SnapshotFolder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>('all');
  const [foldersLoading, setFoldersLoading] = useState(false);

  // Recovery items - loaded once, filtered locally
  const [allRecoveryItems, setAllRecoveryItems] = useState<RecoveryItem[]>([]);
  const [recoveryItems, setRecoveryItems] = useState<RecoveryItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemCount, setItemCount] = useState(0);
  const [selectedItem, setSelectedItem] = useState<RecoveryItem | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);

  // Toolbar
  const [searchQuery, setSearchQuery] = useState('');

  // Load resources with backups
  useEffect(() => {
    if (!tenantId) return;
    setResourcesLoading(true);
    SnapshotService.listResourcesWithBackups(tenantId, 1, 200)
      .then((data) => {
        setResources(data.items || []);
        // Auto-select resource from URL param or first available
        const resourceId = searchParams.get('resourceId');
        if (resourceId) {
          const found = data.items.find(r => r.id === resourceId);
          if (found) setSelectedResource(found);
        } else if (data.items.length > 0) {
          setSelectedResource(data.items[0]);
        }
      })
      .catch(console.error)
      .finally(() => setResourcesLoading(false));
  }, [tenantId]);

  // Load snapshots for selected resource
  useEffect(() => {
    if (!selectedResource) {
      setSnapshots([]);
      setSelectedSnapshotId('');
      return;
    }

    setSnapshotsLoading(true);
    SnapshotService.listByResource(selectedResource.id, 1, 50)
      .then((data) => {
        setSnapshots(data.content);
        if (data.content.length > 0) {
          const snapshotParam = searchParams.get('snapshotId');
          const initial = snapshotParam && data.content.find(s => s.id === snapshotParam)
            ? snapshotParam
            : data.content[0].id;
          setSelectedSnapshotId(initial);
        } else {
          setSelectedSnapshotId('');
        }
      })
      .catch(console.error)
      .finally(() => setSnapshotsLoading(false));
  }, [selectedResource]);

  // Load content types for selected snapshot
  useEffect(() => {
    if (!selectedSnapshotId) {
      setContentTypes([]);
      setActiveContentType('');
      return;
    }

    setContentTypesLoading(true);
    SnapshotService.getContentTypes(selectedSnapshotId)
      .then((types) => {
        setContentTypes(types);
        if (types.length > 0) {
          setActiveContentType(types[0]);
        }
      })
      .catch(console.error)
      .finally(() => setContentTypesLoading(false));
  }, [selectedSnapshotId]);

  // Load ALL recovery items once when snapshot changes
  useEffect(() => {
    if (!selectedSnapshotId || !selectedResource) {
      setAllRecoveryItems([]);
      setRecoveryItems([]);
      setItemCount(0);
      return;
    }

    setItemsLoading(true);
    // Load all items without contentType filter - we'll filter locally
    SnapshotService.listItems(selectedSnapshotId, 1, 500)
      .then((data) => {
        setAllRecoveryItems(data.content);
      })
      .catch((error) => {
        console.error('Failed to load items:', error);
        setAllRecoveryItems([]);
      })
      .finally(() => setItemsLoading(false));
  }, [selectedSnapshotId, selectedResource]);

  // Filter items locally when content type, folder, or search changes
  const filterItemsLocally = useCallback(() => {
    let filtered = allRecoveryItems;

    // Filter by content type
    if (activeContentType) {
      filtered = filtered.filter(item => item.itemType === activeContentType);
    }

    // Filter by folder
    if (selectedFolder && selectedFolder !== 'all') {
      filtered = filtered.filter(item => item.folderPath === selectedFolder);
    }

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(item =>
        item.name?.toLowerCase().includes(query) ||
        item.externalId?.toLowerCase().includes(query) ||
        item.subject?.toLowerCase().includes(query) ||
        item.itemType?.toLowerCase().includes(query)
      );
    }

    setRecoveryItems(filtered);
    setItemCount(filtered.length);
  }, [allRecoveryItems, activeContentType, selectedFolder, searchQuery]);

  // Load folders for selected snapshot (all folders, not filtered by content type)
  useEffect(() => {
    if (!selectedSnapshotId) {
      setFolders([]);
      setSelectedFolder('all');
      return;
    }

    setFoldersLoading(true);
    // Load folders without contentType filter to show all available folders
    SnapshotService.getFolders(selectedSnapshotId)
      .then((data) => {
        const folderList = [{ path: '', count: data.reduce((sum, f) => sum + f.count, 0) }, ...data];
        setFolders(folderList);
        setSelectedFolder('all');
      })
      .catch(console.error)
      .finally(() => setFoldersLoading(false));
  }, [selectedSnapshotId]);

  // Filter items locally when filters change
  useEffect(() => {
    filterItemsLocally();
  }, [filterItemsLocally]);

  const handleResourceSelect = (resource: ResourceWithBackups) => {
    if (selectedResource?.id === resource.id) {
      // Already selected, do nothing
      return;
    }
    setSelectedResource(resource);
    setSelectedSnapshotId('');
    setSelectedItem(null);
    setSelectedItems(new Set());
    setSearchParams({ resourceId: resource.id });
  };

  const handleSnapshotChange = (snapshotId: string) => {
    setSelectedSnapshotId(snapshotId);
    setSelectedItem(null);
    setSelectedItems(new Set());
  };

  const toggleSelectItem = (itemId: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const handleRecover = () => {
    if (!selectedSnapshotId || selectedItems.size === 0) return;
    setRestoreModalOpen(true);
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
      })
      .catch(console.error);
  };

  // Filter resources by search
  const filteredResources = resourceSearch
    ? resources.filter(r =>
        r.name.toLowerCase().includes(resourceSearch.toLowerCase()) ||
        (r.email && r.email.toLowerCase().includes(resourceSearch.toLowerCase()))
      )
    : resources;

  // Loading state
  if (resourcesLoading) {
    return (
      <div className="recovery-page">
        <div className="loading-container">
          <div className="spinner" />
          <p>Loading recovery data...</p>
        </div>
      </div>
    );
  }

  const selectedRecoveryItems = recoveryItems.filter((item) => selectedItems.has(item.id));
  const restoreItemName = selectedRecoveryItems.length === 1
    ? selectedRecoveryItems[0].name
    : selectedRecoveryItems.length > 1
      ? `${selectedRecoveryItems.length} items`
      : undefined;
  const restoreItemType = selectedRecoveryItems.length > 0 && selectedRecoveryItems.every((item) => item.itemType === selectedRecoveryItems[0].itemType)
    ? selectedRecoveryItems[0].itemType
    : undefined;

  // No resources with backups
  if (resources.length === 0) {
    return (
      <div className="recovery-page">
        <div className="loading-container">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 48, height: 48, color: '#94a3b8' }}>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <line x1="2" y1="2" x2="22" y2="22" stroke="#94a3b8" strokeWidth="2" />
          </svg>
          <p style={{ marginTop: 16, fontSize: 16, fontWeight: 600, color: '#0f172a' }}>No backups available</p>
          <p style={{ color: '#64748b', marginBottom: 24, textAlign: 'center' }}>
            No resources in this tenant have been backed up yet.<br />
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
    <>
      <div className="recovery-page">
      {/* Two-panel layout: Resource list + Recovery content */}
      <div className="recovery-layout">
        {/* Left Panel: Resource List */}
        <div className="resource-list-panel">
          <div className="resource-list-header">
            <h3>Backed up resources</h3>
            <input
              type="text"
              placeholder="Search resources..."
              className="resource-search-input"
              value={resourceSearch}
              onChange={(e) => setResourceSearch(e.target.value)}
            />
          </div>
          <div className="resource-list">
            {filteredResources.map(resource => (
              <button
                key={resource.id}
                className={`resource-list-item ${selectedResource?.id === resource.id ? 'selected' : ''}`}
                onClick={() => handleResourceSelect(resource)}
              >
                <div className="resource-avatar-sm">{getInitials(resource.name)}</div>
                <div className="resource-list-info">
                  <div className="resource-list-name">{resource.name}</div>
                  {resource.email && <div className="resource-list-email">{resource.email}</div>}
                  <div className="resource-list-meta">
                    <span className="kind-badge">{getKindLabel(resource.kind)}</span>
                    <span>{resource.snapshot_count} snapshot{resource.snapshot_count !== 1 ? 's' : ''}</span>
                  </div>
                </div>
              </button>
            ))}
            {filteredResources.length === 0 && (
              <div className="empty-resource-list">
                <p>No matching resources</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel: Recovery Content */}
        <div className="recovery-content-panel">
          {!selectedResource ? (
            <div className="empty-selection">
              <p>Select a resource to browse backups</p>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="recovery-header">
                <div className="header-left">
                  <div className="resource-avatar">{getInitials(selectedResource.name)}</div>
                  <div className="resource-info">
                    <div className="resource-name">{selectedResource.name}</div>
                    {selectedResource.email && <div className="resource-email">{selectedResource.email}</div>}
                  </div>
                  {selectedResource.last_backup_at && (
                    <div className="last-backup-info">
                      <span className="label">Last backup:</span>
                      <span className="value">
                        {new Date(selectedResource.last_backup_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}, {new Date(selectedResource.last_backup_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                      </span>
                    </div>
                  )}
                </div>

                <div className="header-stats">
                  <div className="stats-box">
                    <div className="stats-label">Backup size</div>
                    <div className="stats-value">{formatSize(selectedResource.storage_bytes)}</div>
                    <div className="stats-legend">
                      <span>{selectedResource.snapshot_count} snapshot{selectedResource.snapshot_count !== 1 ? 's' : ''}</span>
                      <span>·</span>
                      <span>{selectedResource.total_items.toLocaleString()} total items</span>
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
                          {snapshot.label ? ` — ${snapshot.label}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Content Type Tabs */}
              <div className="content-type-tabs">
                {contentTypesLoading ? (
                  <div className="tabs-loading">
                    <div className="spinner-sm" />
                    Loading content types...
                  </div>
                ) : contentTypes.length === 0 ? (
                  <div className="tabs-empty">No content types found</div>
                ) : (
                  contentTypes.map(type => (
                    <button
                      key={type}
                      className={`content-tab ${activeContentType === type ? 'active' : ''}`}
                      onClick={() => setActiveContentType(type)}
                    >
                      {formatContentTypeLabel(type)}
                    </button>
                  ))
                )}
              </div>

              {/* Toolbar */}
              <div className="recovery-toolbar">
                <div className="toolbar-left">
                  <div className="search-wrapper">
                    <input
                      type="text"
                      placeholder="Search items..."
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
                    <button
                      className={`folder-item ${selectedFolder === 'all' ? 'active' : ''}`}
                      onClick={() => setSelectedFolder('all')}
                    >
                      <span className="folder-name">All</span>
                    </button>
                    {foldersLoading && (
                      <div className="folder-loading">
                        <div className="spinner-sm" />
                      </div>
                    )}
                    {folders.filter(f => f.path).map(folder => (
                      <button
                        key={folder.path}
                        className={`folder-item ${selectedFolder === folder.path ? 'active' : ''}`}
                        onClick={() => setSelectedFolder(folder.path)}
                      >
                        <span className="folder-name">{folder.path}</span>
                        {folder.count > 0 && <span className="folder-count">{folder.count}</span>}
                      </button>
                    ))}
                    {!foldersLoading && folders.filter(f => f.path).length === 0 && (
                      <div className="folder-empty">
                        <p>No folders found</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Middle Panel: Item List */}
                <div className="panel-middle">
                  <div className="item-list-header">
                    <span className="item-count">Items: {itemCount}</span>
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
                          <div className="item-date">
                            {item.date ? new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                          </div>
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
            </>
          )}
        </div>
      </div>
      </div>
      <RestoreModal
        isOpen={restoreModalOpen}
        onClose={() => setRestoreModalOpen(false)}
        itemIds={Array.from(selectedItems)}
        snapshotIds={selectedSnapshotId ? [selectedSnapshotId] : []}
        itemName={restoreItemName}
        itemType={restoreItemType}
      />
    </>
  );
}
