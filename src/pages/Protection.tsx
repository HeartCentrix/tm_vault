import { useState, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getResources } from '../services/resource';
import type { ResourceItem, ResourceListResponse } from '../services/resource';
import './Protection.css';

type ResourceTab = 'all' | 'users' | 'shared' | 'rooms' | 'sharepoint' | 'groups' | 'entra' | 'power' | 'dynamic';

interface Resource {
  id: string;
  name: string;
  type: string;
  status: string;
  sla?: string;
  lastBackup?: string;
}

const tabs: { key: ResourceTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'users', label: 'Users' },
  { key: 'shared', label: 'Shared mailboxes' },
  { key: 'rooms', label: 'Rooms' },
  { key: 'sharepoint', label: 'SharePoint' },
  { key: 'groups', label: 'Groups & Teams' },
  { key: 'entra', label: 'Entra ID' },
  { key: 'power', label: 'Power Platform' },
  { key: 'dynamic', label: 'Dynamic groups' },
  { key: 'entra-groups', label: 'Entra ID groups' },
];

export default function Protection() {
  const { tenantId, serviceType } = useParams<{ tenantId: string; serviceType: string }>();
  const [activeTab, setActiveTab] = useState<ResourceTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedResources, setSelectedResources] = useState<string[]>([]);
  const [showFilter, setShowFilter] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Active filters - one per section
  // null means the section header (All resources/All sizes/All SLAs) is active
  const [resourceFilter, setResourceFilter] = useState<string | null>(null);
  const [sizeFilter, setSizeFilter] = useState<string | null>(null);
  const [slaFilter, setSlaFilter] = useState<string | null>(null);

  // Fetch resources from API
  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    setResources([]); // Clear previous tab's data
    getResources(tenantId, activeTab, page, 50, searchQuery, slaFilter, resourceFilter)
      .then((data: ResourceListResponse) => {
        setResources(data.items || []);
        setTotalPages(data.item_number > 0 ? Math.ceil(data.item_number / 50) : 1);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [tenantId, activeTab, page, searchQuery, slaFilter, resourceFilter]);

  // Reset page when tab changes
  useEffect(() => {
    setPage(1);
  }, [activeTab, searchQuery, slaFilter, resourceFilter]);

  // Close filter dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setShowFilter(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const activeFilterCount = (resourceFilter ? 1 : 0) + (sizeFilter ? 1 : 0) + (slaFilter ? 1 : 0);

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'protected': return 'Protected';
      case 'discovered': return 'Discovered';
      case 'archived': return 'Archived';
      case 'suspended': return 'Suspended';
      default: return status;
    }
  };

  const formatKind = (kind: string) => {
    const map: Record<string, string> = {
      office_user: 'Mailbox', shared_mailbox: 'Shared Mailbox', room_mailbox: 'Room Mailbox',
      onedrive: 'OneDrive', sharepoint_site: 'SharePoint Site',
      teams_channel: 'Teams Channel', teams_chat: 'Teams Chat',
      entra_user: 'Entra User', entra_group: 'Entra Group', entra_app: 'Entra App',
      azure_vm: 'Azure VM', azure_sql: 'Azure SQL', azure_postgresql: 'Azure PostgreSQL',
    };
    return map[kind] || kind;
  };

  const getEmptyMessage = () => {
    const labels: Record<string, string> = {
      all: 'resources',
      users: 'users',
      shared: 'shared mailboxes',
      rooms: 'rooms',
      sharepoint: 'SharePoint sites',
      groups: 'groups & teams',
      entra: 'Entra ID resources',
      power: 'Power Platform resources',
      dynamic: 'dynamic groups',
      'entra-groups': 'Entra ID groups',
    };
    const label = labels[activeTab] || 'resources';
    return `No ${label} found.`;
  };

  const toggleSelectAll = () => {
    if (selectedResources.length === resources.length) {
      setSelectedResources([]);
    } else {
      setSelectedResources(resources.map(r => r.id));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedResources(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  return (
    <div className="protection-page">
      {/* Tabs */}
      <div className="resource-tabs">
        {/* Primary tabs */}
        <button
          className={`resource-tab ${activeTab === 'all' ? 'active' : ''}`}
          onClick={() => setActiveTab('all')}
        >
          All resources
        </button>
        <button
          className={`resource-tab ${activeTab === 'users' ? 'active' : ''}`}
          onClick={() => setActiveTab('users')}
        >
          Users
        </button>
        <button
          className={`resource-tab ${activeTab === 'shared' ? 'active' : ''}`}
          onClick={() => setActiveTab('shared')}
        >
          Shared mailboxes
        </button>
        <button
          className={`resource-tab ${activeTab === 'rooms' ? 'active' : ''}`}
          onClick={() => setActiveTab('rooms')}
        >
          Rooms
        </button>

        <div className="tab-divider" />

        {/* SharePoint */}
        <button
          className={`resource-tab pill ${activeTab === 'sharepoint' ? 'active' : ''}`}
          onClick={() => setActiveTab('sharepoint')}
        >
          SharePoint sites
        </button>

        <button
          className={`resource-tab ${activeTab === 'groups' ? 'active' : ''}`}
          onClick={() => setActiveTab('groups')}
        >
          Groups & Teams
        </button>
        <button
          className={`resource-tab ${activeTab === 'entra' ? 'active' : ''}`}
          onClick={() => setActiveTab('entra')}
        >
          Entra ID
        </button>
        <button
          className={`resource-tab ${activeTab === 'power' ? 'active' : ''}`}
          onClick={() => setActiveTab('power')}
        >
          Power Platform
        </button>

        {/* Auto-protection group */}
        <fieldset className="auto-protection-group">
          <legend className="auto-protection-label">Auto-protection</legend>
          <div className="auto-protection-tabs">
            <button
              className={`resource-tab ${activeTab === 'entra-groups' ? 'active' : ''}`}
              onClick={() => setActiveTab('entra-groups')}
            >
              Entra ID groups
            </button>
            <button
              className={`resource-tab ${activeTab === 'dynamic' ? 'active' : ''}`}
              onClick={() => setActiveTab('dynamic')}
            >
              Dynamic groups
            </button>
          </div>
        </fieldset>
      </div>

      {/* Action Bar */}
      <div className="action-bar">
        <div className="action-bar-left">
          <div className="search-wrapper">
            <input
              type="text"
              placeholder="Search resources"
              className="search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </div>
          <div className="action-buttons">
            <button className="action-btn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 14, height: 14}}>
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
              Backup now
            </button>
            <button className="action-btn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 14, height: 14}}>
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              Assign SLA
            </button>
            <div className="filter-wrapper" ref={filterRef}>
              <button className={`action-btn filter-btn ${activeFilterCount > 0 ? 'has-filters' : ''}`} onClick={() => setShowFilter(!showFilter)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 14, height: 14}}>
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                </svg>
                Filter
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 14, height: 14, marginLeft: 4}}>
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
              {showFilter && (
                <div className="filter-dropdown">
                  {/* All resources section */}
                  <div className="filter-section">
                    <div className={`filter-section-header ${resourceFilter === null ? 'active' : ''}`} onClick={() => setResourceFilter(null)}>
                      <span className="section-check" style={{visibility: resourceFilter === null ? 'visible' : 'hidden'}}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{width: 16, height: 16}}>
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </span>
                      All resources
                    </div>
                    <div className={`filter-section-item ${resourceFilter === 'active' ? 'active' : ''}`} onClick={() => setResourceFilter('active')}>
                      <span className="section-check" style={{visibility: resourceFilter === 'active' ? 'visible' : 'hidden'}}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{width: 16, height: 16}}>
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </span>
                      Active only
                    </div>
                    <div className={`filter-section-item ${resourceFilter === 'archived' ? 'active' : ''}`} onClick={() => setResourceFilter('archived')}>
                      <span className="section-check" style={{visibility: resourceFilter === 'archived' ? 'visible' : 'hidden'}}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{width: 16, height: 16}}>
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </span>
                      Archived only
                    </div>
                  </div>
                  <div className="filter-divider" />

                  {/* All sizes section */}
                  <div className="filter-section">
                    <div className={`filter-section-header ${sizeFilter === null ? 'active' : ''}`} onClick={() => setSizeFilter(null)}>
                      <span className="section-check" style={{visibility: sizeFilter === null ? 'visible' : 'hidden'}}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{width: 16, height: 16}}>
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </span>
                      All sizes
                    </div>
                    <div className={`filter-section-item ${sizeFilter === 'total' ? 'active' : ''}`} onClick={() => setSizeFilter('total')}>
                      <span className="section-check" style={{visibility: sizeFilter === 'total' ? 'visible' : 'hidden'}}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{width: 16, height: 16}}>
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </span>
                      Top by total size
                    </div>
                    <div className={`filter-section-item ${sizeFilter === '7d' ? 'active' : ''}`} onClick={() => setSizeFilter('7d')}>
                      <span className="section-check" style={{visibility: sizeFilter === '7d' ? 'visible' : 'hidden'}}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{width: 16, height: 16}}>
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </span>
                      Top by storage growth (7d)
                    </div>
                    <div className={`filter-section-item ${sizeFilter === '30d' ? 'active' : ''}`} onClick={() => setSizeFilter('30d')}>
                      <span className="section-check" style={{visibility: sizeFilter === '30d' ? 'visible' : 'hidden'}}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{width: 16, height: 16}}>
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </span>
                      Top by storage growth (30d)
                    </div>
                    <div className={`filter-section-item ${sizeFilter === '365d' ? 'active' : ''}`} onClick={() => setSizeFilter('365d')}>
                      <span className="section-check" style={{visibility: sizeFilter === '365d' ? 'visible' : 'hidden'}}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{width: 16, height: 16}}>
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </span>
                      Top by storage growth (365d)
                    </div>
                  </div>
                  <div className="filter-divider" />

                  {/* All SLAs section */}
                  <div className="filter-section">
                    <div className={`filter-section-header ${slaFilter === null ? 'active' : ''}`} onClick={() => setSlaFilter(null)}>
                      <span className="section-check" style={{visibility: slaFilter === null ? 'visible' : 'hidden'}}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{width: 16, height: 16}}>
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </span>
                      All SLAs
                    </div>
                    <div className={`filter-section-item ${slaFilter === 'Gold' ? 'active' : ''}`} onClick={() => setSlaFilter('Gold')}>
                      <span className="section-check" style={{visibility: slaFilter === 'Gold' ? 'visible' : 'hidden'}}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{width: 16, height: 16}}>
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </span>
                      Gold
                    </div>
                    <div className={`filter-section-item ${slaFilter === 'Silver' ? 'active' : ''}`} onClick={() => setSlaFilter('Silver')}>
                      <span className="section-check" style={{visibility: slaFilter === 'Silver' ? 'visible' : 'hidden'}}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{width: 16, height: 16}}>
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </span>
                      Silver
                    </div>
                    <div className={`filter-section-item ${slaFilter === 'Bronze' ? 'active' : ''}`} onClick={() => setSlaFilter('Bronze')}>
                      <span className="section-check" style={{visibility: slaFilter === 'Bronze' ? 'visible' : 'hidden'}}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{width: 16, height: 16}}>
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </span>
                      Bronze
                    </div>
                    <div className={`filter-section-item ${slaFilter === 'Manual' ? 'active' : ''}`} onClick={() => setSlaFilter('Manual')}>
                      <span className="section-check" style={{visibility: slaFilter === 'Manual' ? 'visible' : 'hidden'}}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{width: 16, height: 16}}>
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </span>
                      Manual
                    </div>
                    <div className={`filter-section-item ${slaFilter === 'Not protected' ? 'active' : ''}`} onClick={() => setSlaFilter('Not protected')}>
                      <span className="section-check" style={{visibility: slaFilter === 'Not protected' ? 'visible' : 'hidden'}}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{width: 16, height: 16}}>
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </span>
                      Not protected
                    </div>
                  </div>
                </div>
              )}
            </div>
            <button className="action-btn icon-only" title="Refresh">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 16, height: 16}}>
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
            </button>
          </div>
        </div>
        <div className="pagination">
          <button className="pagination-btn" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 16, height: 16}}>
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <span className="pagination-page">{page} / {totalPages || 1}</span>
          <button className="pagination-btn" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 16, height: 16}}>
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Resources Table */}
      <div className="resources-table-container">
        <table className="resources-table">
          <thead>
            <tr>
              <th className="checkbox-cell">
                <input
                  type="checkbox"
                  checked={selectedResources.length === resources.length && resources.length > 0}
                  onChange={toggleSelectAll}
                />
              </th>
              <th>Name</th>
              <th>Type</th>
              <th>SLA Policy</th>
              <th>Status</th>
              <th>Last Backup</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="text-muted" style={{textAlign:'center', padding: 32}}>Loading...</td></tr>
            )}
            {!loading && resources.length === 0 && (
              <tr><td colSpan={7} className="text-muted" style={{textAlign:'center', padding: 32}}>{getEmptyMessage()}</td></tr>
            )}
            {!loading && resources.map((resource) => (
              <tr key={resource.id}>
                <td className="checkbox-cell">
                  <input
                    type="checkbox"
                    checked={selectedResources.includes(resource.id)}
                    onChange={() => toggleSelect(resource.id)}
                  />
                </td>
                <td className="resource-name">{resource.name}</td>
                <td>{formatKind(resource.kind)}</td>
                <td>
                  {resource.sla ? (
                    <span className={`sla-badge sla-${resource.sla.toLowerCase()}`}>{resource.sla}</span>
                  ) : (
                    <span className="sla-none">None</span>
                  )}
                </td>
                <td>
                  <span className={`status-badge ${resource.status === 'protected' ? 'success' : 'warning'}`}>
                    {getStatusLabel(resource.status)}
                  </span>
                </td>
                <td className="text-muted">{resource.last_backup ? 'Available' : '-'}</td>
                <td>
                  <div className="row-actions">
                    <button className="row-action-btn">Backup</button>
                    <button className="row-action-btn">Recover</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
