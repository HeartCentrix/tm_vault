import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getResources, type ResourceItem, type ResourceListResponse, assignPolicy, unassignPolicy } from '../services/resource';
import { getSlaPolicies, type SlaPolicy } from '../services/sla';
import './Protection.css';

type ResourceTab = 'all' | 'users' | 'shared' | 'rooms' | 'sharepoint' | 'groups' | 'entra' | 'power' | 'dynamic';

const tabs: { key: ResourceTab; label: string }[] = [
  { key: 'all', label: 'All resources' },
  { key: 'users', label: 'Users' },
  { key: 'shared', label: 'Shared mailboxes' },
  { key: 'rooms', label: 'Rooms' },
  { key: 'sharepoint', label: 'SharePoint sites' },
  { key: 'groups', label: 'Groups & Teams' },
  { key: 'entra', label: 'Entra ID' },
  { key: 'power', label: 'Power Platform' },
  { key: 'dynamic', label: 'Dynamic groups' },
  { key: 'entra-groups', label: 'Entra ID groups' },
];

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function formatSize(bytes: number): string {
  if (!bytes || bytes === 0) return '0 GB';
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function getSlaDescription(p: SlaPolicy): string {
  if (p.name === 'Manual') return 'Manual backups only';
  const freq = p.frequency === 'THREE_DAILY' ? 'Every day, 3x per day' : 'Every day';
  if (p.backupWindowStart && p.frequency !== 'THREE_DAILY') {
    const hour = parseInt(p.backupWindowStart.split(':')[0], 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const h = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
    return `${freq} at ${h}:00 ${ampm}`;
  }
  return freq;
}

function SlaCell({ resource, policies, onChange, onSettings }: {
  resource: ResourceItem;
  policies: SlaPolicy[];
  onChange: (resourceId: string, policyId: string) => void;
  onSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const policyId = resource.protections?.[0]?.policy_id;
  const selected = policies.find(p => p.id === policyId);
  const isProtected = !!policyId;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="sla-dropdown" ref={ref}>
      <button className={`sla-header ${!isProtected ? 'not-protected' : ''}`} onClick={() => setOpen(!open)}>
        {!isProtected && (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="sla-header-icon-left">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <line x1="2" y1="2" x2="22" y2="22" stroke="#dc2626" strokeWidth="2" />
          </svg>
        )}
        <span className="sla-header-text">
          {isProtected ? selected?.name : 'Not protected'}
        </span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="sla-header-icon-right">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="sla-menu">
          <button className="sla-item" onClick={() => { onChange(resource.id, ''); setOpen(false); }}>
            <div>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14, marginRight: 8, flexShrink: 0, marginTop: 2 }}>
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <line x1="2" y1="2" x2="22" y2="22" stroke="#dc2626" strokeWidth="2" />
              </svg>
              <div className="sla-item-text"><span className="sla-item-name">Not protected</span></div>
            </div>
          </button>
          {policies.map(p => (
            <button key={p.id} className={`sla-item ${policyId === p.id ? 'selected' : ''}`} onClick={() => { onChange(resource.id, p.id); setOpen(false); }}>
              <div className="sla-item-text">
                <span className="sla-item-name">{p.name}</span>
                <span className="sla-item-desc">{getSlaDescription(p)}</span>
              </div>
            </button>
          ))}
          <div className="sla-divider" />
          <button className="sla-footer" onClick={() => { onSettings(); setOpen(false); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14, marginRight: 8, flexShrink: 0 }}>
              <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Customize SLA policies in Settings
          </button>
        </div>
      )}
    </div>
  );
}

export default function Protection() {
  const { tenantId, serviceType } = useParams<{ tenantId: string; serviceType: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<ResourceTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedResources, setSelectedResources] = useState<string[]>([]);
  const [showFilter, setShowFilter] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [policies, setPolicies] = useState<SlaPolicy[]>([]);

  const [resourceFilter, setResourceFilter] = useState<string | null>(null);
  const [sizeFilter, setSizeFilter] = useState<string | null>(null);
  const [slaFilter, setSlaFilter] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    getSlaPolicies(tenantId).then(setPolicies).catch(console.error);
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    setResources([]);
    getResources(tenantId, activeTab, page, 50, searchQuery, slaFilter, resourceFilter)
      .then((data: ResourceListResponse) => {
        setResources(data.items || []);
        setTotalPages(data.item_number > 0 ? Math.ceil(data.item_number / 50) : 1);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [tenantId, activeTab, page, searchQuery, slaFilter, resourceFilter]);

  useEffect(() => { setPage(1); }, [activeTab, searchQuery, slaFilter, resourceFilter]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) setShowFilter(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const activeFilterCount = (resourceFilter ? 1 : 0) + (sizeFilter ? 1 : 0) + (slaFilter ? 1 : 0);

  const toggleSelectAll = () => {
    setSelectedResources(selectedResources.length === resources.length ? [] : resources.map(r => r.id));
  };

  const toggleSelect = (id: string) => {
    setSelectedResources(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleSlaChange = async (resourceId: string, policyId: string) => {
    try {
      if (policyId) await assignPolicy(resourceId, policyId);
      else await unassignPolicy(resourceId);
      setResources(prev => prev.map(r =>
        r.id === resourceId ? { ...r, protections: policyId ? [{ policy_id: policyId }] : null } : r
      ));
    } catch (err) {
      console.error('Failed to update SLA:', err);
    }
  };

  return (
    <div className="protection-page">
      <div className="resource-tabs">
        {tabs.map(tab => (
          tab.key === 'sharepoint' ? (
            <><div className="tab-divider" key={`d-${tab.key}`} /><button key={tab.key} className={`resource-tab pill ${activeTab === tab.key ? 'active' : ''}`} onClick={() => setActiveTab(tab.key)}>{tab.label}</button></>
          ) : tab.key !== 'dynamic' && tab.key !== 'entra-groups' ? (
            <button key={tab.key} className={`resource-tab ${activeTab === tab.key ? 'active' : ''}`} onClick={() => setActiveTab(tab.key)}>{tab.label}</button>
          ) : null
        ))}
        <fieldset className="auto-protection-group">
          <legend className="auto-protection-label">Auto-protection</legend>
          <div className="auto-protection-tabs">
            <button className={`resource-tab ${activeTab === 'entra-groups' ? 'active' : ''}`} onClick={() => setActiveTab('entra-groups')}>Entra ID groups</button>
            <button className={`resource-tab ${activeTab === 'dynamic' ? 'active' : ''}`} onClick={() => setActiveTab('dynamic')}>Dynamic groups</button>
          </div>
        </fieldset>
      </div>

      <div className="action-bar">
        <div className="action-bar-left">
          <div className="search-wrapper">
            <input type="text" placeholder="Search resources" className="search-input" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          </div>
          <div className="action-buttons">
            <button className="action-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}><polygon points="5 3 19 12 5 21 5 3" /></svg>Backup now</button>
            <button className="action-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>Assign SLA</button>
            <div className="filter-wrapper" ref={filterRef}>
              <button className={`action-btn filter-btn ${activeFilterCount > 0 ? 'has-filters' : ''}`} onClick={() => setShowFilter(!showFilter)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14 }}><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>Filter
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14, marginLeft: 4 }}><polyline points="6 9 12 15 18 9" /></svg>
              </button>
              {showFilter && (
                <div className="filter-dropdown">
                  <div className="filter-section">
                    <div className={`filter-section-header ${resourceFilter === null ? 'active' : ''}`} onClick={() => setResourceFilter(null)}>
                      <span className="section-check" style={{ visibility: resourceFilter === null ? 'visible' : 'hidden' }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 16, height: 16 }}><polyline points="20 6 9 17 4 12" /></svg></span>All resources
                    </div>
                    <div className={`filter-section-item ${resourceFilter === 'active' ? 'active' : ''}`} onClick={() => setResourceFilter('active')}>
                      <span className="section-check" style={{ visibility: resourceFilter === 'active' ? 'visible' : 'hidden' }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 16, height: 16 }}><polyline points="20 6 9 17 4 12" /></svg></span>Active only
                    </div>
                    <div className={`filter-section-item ${resourceFilter === 'archived' ? 'active' : ''}`} onClick={() => setResourceFilter('archived')}>
                      <span className="section-check" style={{ visibility: resourceFilter === 'archived' ? 'visible' : 'hidden' }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 16, height: 16 }}><polyline points="20 6 9 17 4 12" /></svg></span>Archived only
                    </div>
                  </div>
                  <div className="filter-divider" />
                  <div className="filter-section">
                    <div className={`filter-section-header ${slaFilter === null ? 'active' : ''}`} onClick={() => setSlaFilter(null)}>
                      <span className="section-check" style={{ visibility: slaFilter === null ? 'visible' : 'hidden' }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 16, height: 16 }}><polyline points="20 6 9 17 4 12" /></svg></span>All SLAs
                    </div>
                    {['Not protected', ...policies.map(p => p.name)].map(sla => (
                      <div key={sla} className={`filter-section-item ${slaFilter === sla ? 'active' : ''}`} onClick={() => setSlaFilter(sla)}>
                        <span className="section-check" style={{ visibility: slaFilter === sla ? 'visible' : 'hidden' }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ width: 16, height: 16 }}><polyline points="20 6 9 17 4 12" /></svg></span>{sla}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <button className="action-btn icon-only" title="Refresh"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg></button>
          </div>
        </div>
        <div className="pagination">
          <button className="pagination-btn" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}><polyline points="15 18 9 12 15 6" /></svg></button>
          <span className="pagination-page">{page} / {totalPages || 1}</span>
          <button className="pagination-btn" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16 }}><polyline points="9 18 15 12 9 6" /></svg></button>
        </div>
      </div>

      <div className="resources-table-container">
        <table className="resources-table">
          <thead>
            <tr>
              <th className="checkbox-cell"><input type="checkbox" checked={selectedResources.length === resources.length && resources.length > 0} onChange={toggleSelectAll} /></th>
              <th>Resources <span className="th-icon">⌄</span></th>
              <th>SLA <span className="th-icon">⌄</span></th>
              <th className="size-col"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14, marginRight: 4, verticalAlign: 'middle' }}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></svg>Total size</th>
              <th>Last backup</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: '#94a3b8' }}>Loading...</td></tr>}
            {!loading && resources.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: '#94a3b8' }}>No resources found.</td></tr>}
            {!loading && resources.map(resource => (
              <tr key={resource.id}>
                <td className="checkbox-cell"><input type="checkbox" checked={selectedResources.includes(resource.id)} onChange={() => toggleSelect(resource.id)} /></td>
                <td className="resource-name-cell">
                  <div className="resource-avatar">{getInitials(resource.name)}</div>
                  <div className="resource-info">
                    <div className="resource-display-name">{resource.name}</div>
                    {resource.email && <div className="resource-email">{resource.email}</div>}
                    {resource.kind && !resource.email && <div className="resource-email">{resource.kind.replace(/_/g, ' ')}</div>}
                  </div>
                </td>
                <td className="sla-cell">
                  <SlaCell resource={resource} policies={policies} onChange={handleSlaChange} onSettings={() => navigate(`/tenants/${tenantId}/settings`)} />
                </td>
                <td className="size-cell">
                  <div className="size-main">{formatSize(resource.usage?.size || 0)}</div>
                  <div className="size-sub">
                    <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 12, height: 12, marginRight: 2, verticalAlign: 'middle' }}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>{resource.usage?.backups || 0}</span>
                    <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 12, height: 12, marginRight: 2, verticalAlign: 'middle' }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>0</span>
                  </div>
                </td>
                <td className="backup-cell">
                  {resource.last_backup ? (
                    <><div className="backup-date">{new Date(resource.last_backup).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                      <div className="backup-time">{new Date(resource.last_backup).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}</div>
                      <span className="backup-status done"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14, marginRight: 4 }}><polyline points="20 6 9 17 4 12" /></svg>Done</span></>
                  ) : <span className="backup-status never">Never backed up</span>}
                </td>
                <td className="actions-cell">
                  <button className="action-btn-sm">Backup now</button>
                  <button className="action-btn-sm">Recover <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14, marginLeft: 2, verticalAlign: 'middle' }}><polyline points="9 18 15 12 9 6" /></svg></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
