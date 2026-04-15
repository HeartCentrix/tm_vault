import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import './GlobalSearch.css';
import { SearchService, type SearchResult } from '../services/search';
import { RestoreModal } from '../components/RestoreModal';
import { getResources } from '../services/resource';
import type { ResourceItem } from '../services/resource';

type WorkloadType = 'emails' | 'files' | 'chats' | 'channel' | 'copilot' | 'calendar' | 'contacts' | 'exchange' | 'planner';

interface WorkloadOption {
  key: WorkloadType;
  label: string;
  icon: React.ReactNode;
  backendType?: string;
}

// SVG Icon Components
const EmailIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 -960 960 960" fill="currentColor">
    <path d="M172.31-180Q142-180 121-201q-21-21-21-51.31v-455.38Q100-738 121-759q21-21 51.31-21h615.38Q818-780 839-759q21 21 21 51.31v455.38Q860-222 839-201q-21 21-51.31 21H172.31ZM480-457.69 160-662.31v410q0 5.39 3.46 8.85t8.85 3.46h615.38q5.39 0 8.85-3.46t3.46-8.85v-410L480-457.69Zm0-62.31 313.85-200h-627.7L480-520ZM160-662.31V-720v467.69q0 5.39 3.46 8.85t8.85 3.46H160v-422.31Z"></path>
  </svg>
);

const FilesFolderIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 -960 960 960" fill="currentColor">
    <path d="M172.31-180Q142-180 121-201q-21-21-21-51.31v-455.38Q100-738 121-759q21-21 51.31-21h219.61l80 80h315.77Q818-700 839-679q21 21 21 51.31v375.38Q860-222 839-201q-21 21-51.31 21H172.31Zm0-60h615.38q5.39 0 8.85-3.46t3.46-8.85v-375.38q0-5.39-3.46-8.85t-8.85-3.46H447.38l-80-80H172.31q-5.39 0-8.85 3.46t-3.46 8.85v455.38q0 5.39 3.46 8.85t8.85 3.46ZM160-240v-480 480Z"></path>
  </svg>
);

const ChatMessageIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 -960 960 960" fill="currentColor">
    <path d="M250-410h300v-60H250v60Zm0-120h460v-60H250v60Zm0-120h460v-60H250v60ZM100-118.46v-669.23Q100-818 121-839q21-21 51.31-21h615.38Q818-860 839-839q21 21 21 51.31v455.38Q860-302 839-281q-21 21-51.31 21H241.54L100-118.46ZM216-320h571.69q4.62 0 8.46-3.85 3.85-3.84 3.85-8.46v-455.38q0-4.62-3.85-8.46-3.84-3.85-8.46-3.85H172.31q-4.62 0-8.46 3.85-3.85 3.84-3.85 8.46v523.08L216-320Zm-56 0v-480 480Z"></path>
  </svg>
);

const CopilotIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M4.69405 17.2446C5.24991 17.2627 5.50461 17.4556 5.6798 17.688C5.91739 18.0031 6.0556 18.4507 6.24191 19.0835L6.25254 19.1196C6.41716 19.6792 6.63012 20.4032 7.07658 20.9706C7.58358 21.615 8.33343 22.0002 9.4036 22.0002H16.6324C18.1221 22.0002 19.2187 21.0356 20.0072 19.8691C20.8004 18.6957 21.3883 17.1702 21.8439 15.71L21.8455 15.7048C22.3662 14.0356 23.0272 11.9171 23.0027 10.2054C22.9903 9.33711 22.8024 8.4521 22.2166 7.78023C21.6119 7.08669 20.7049 6.75631 19.5545 6.75631H19.3132C18.7574 6.73817 18.5027 6.54526 18.3275 6.3129C18.0899 5.9978 17.9517 5.55021 17.7654 4.9174L17.7548 4.88124C17.5901 4.32166 17.3772 3.59772 16.9307 3.03026C16.4237 2.38586 15.6739 2.00073 14.6037 2.00073H7.37493C5.88524 2.00073 4.78863 2.96529 4.00007 4.13181C3.20688 5.30519 2.61901 6.83073 2.16344 8.29091L2.16184 8.29605C1.64105 9.96526 0.980067 12.0838 1.00457 13.7955C1.017 14.6638 1.20489 15.5488 1.79069 16.2207C2.39539 16.9142 3.30237 17.2446 4.45284 17.2446H4.69405ZM3.59537 8.73766C4.0389 7.31606 4.57492 5.95983 5.24277 4.97187C5.91525 3.97706 6.61685 3.50073 7.37493 3.50073H12.0042C11.8121 3.84482 11.6504 4.22569 11.505 4.61844C11.3066 5.15403 11.1225 5.75722 10.9335 6.37676L10.8914 6.51476C10.1409 8.97183 9.20203 12.1374 8.59718 14.1874C8.33206 15.0859 7.52308 15.71 6.59332 15.7432H4.60686C4.59139 15.7432 4.57602 15.7437 4.56078 15.7446H4.45284C3.58706 15.7446 3.15609 15.5042 2.92129 15.2349C2.66759 14.9439 2.51443 14.474 2.50441 13.774C2.48404 12.3508 3.0512 10.4818 3.59537 8.73766ZM18.7645 19.029C18.092 20.0238 17.3904 20.5002 16.6324 20.5002H12.0031C12.1952 20.1561 12.3569 19.7752 12.5023 19.3825C12.7007 18.8469 12.8848 18.2437 13.0738 17.6241L13.1159 17.4861C13.8664 15.0291 14.8053 11.8635 15.4101 9.81354C15.6752 8.915 16.4842 8.29091 17.414 8.2577H19.4004C19.4159 8.2577 19.4313 8.25723 19.4465 8.25631H19.5545C20.4202 8.25631 20.8512 8.4967 21.086 8.766C21.3397 9.05698 21.4929 9.52689 21.5029 10.2269C21.5233 11.6501 20.9561 13.5191 20.4119 15.2632C19.9684 16.6848 19.4324 18.0411 18.7645 19.029ZM10.4645 15.7432H9.47628C9.72189 15.408 9.9133 15.0272 10.0359 14.6118C10.3021 13.7095 10.6328 12.592 10.9834 11.4147L11.4676 9.80142C11.7427 8.88514 12.5861 8.2577 13.5428 8.2577H14.531C14.2854 8.59287 14.094 8.97365 13.9714 9.38906C13.7052 10.2913 13.3745 11.4089 13.0239 12.5862L12.5397 14.1995C12.2646 15.1158 11.4212 15.7432 10.4645 15.7432ZM13.5428 6.7577C13.118 6.7577 12.7063 6.83083 12.3217 6.96673L12.364 6.82816C12.5575 6.19441 12.7291 5.63197 12.9116 5.13945C13.1069 4.61208 13.2965 4.21677 13.4999 3.93822C13.5469 3.87377 13.6781 3.75776 13.9058 3.6561C14.1242 3.55856 14.3738 3.50073 14.6037 3.50073C15.2609 3.50073 15.5571 3.71022 15.7518 3.95776C15.9974 4.26993 16.1425 4.71607 16.3265 5.34103L16.3495 5.41956C16.4677 5.82259 16.6105 6.30927 16.8437 6.7577H13.5428ZM10.4645 17.2432C10.8893 17.2432 11.301 17.1701 11.6856 17.0342L11.6433 17.1727C11.4498 17.8065 11.2782 18.3689 11.0957 18.8614C10.9004 19.3888 10.7108 19.7841 10.5074 20.0627C10.4604 20.1271 10.3292 20.2431 10.1015 20.3448C9.88305 20.4423 9.63346 20.5002 9.4036 20.5002C8.7464 20.5002 8.45021 20.2907 8.25546 20.0431C8.00986 19.731 7.86484 19.2848 7.68084 18.6599L7.65778 18.5813C7.53959 18.1783 7.39685 17.6916 7.16357 17.2432H10.4645Z"></path>
  </svg>
);

const CalendarIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20a2 2 0 002 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2zm-7 5h5v5h-5v-5z"></path>
  </svg>
);

const ContactsIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 -960 960 960" fill="currentColor">
    <path d="M587.69-240q-38.54 0-65.42-26.88-26.88-26.89-26.88-65.43 0-38.54 26.88-65.42 26.88-26.88 65.42-26.88 38.54 0 65.43 26.88Q680-370.85 680-332.31q0 38.54-26.88 65.43Q626.23-240 587.69-240ZM212.31-100Q182-100 161-121q-21-21-21-51.31v-535.38Q140-738 161-759q21-21 51.31-21h55.38v-84.61h61.54V-780h303.08v-84.61h60V-780h55.38Q778-780 799-759q21 21 21 51.31v535.38Q820-142 799-121q-21 21-51.31 21H212.31Zm0-60h535.38q4.62 0 8.46-3.85 3.85-3.84 3.85-8.46v-375.38H200v375.38q0 4.62 3.85 8.46 3.84 3.85 8.46 3.85ZM200-607.69h560v-100q0-4.62-3.85-8.46-3.84-3.85-8.46-3.85H212.31q-4.62 0-8.46 3.85-3.85 3.84-3.85 8.46v100Zm0 0V-720v112.31Z"></path>
  </svg>
);

const TasksIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 -960 960 960" fill="currentColor">
    <path d="M170-72.31v-60h620v60H170Zm0-755.38v-60h620v60H170ZM480-420q45.77 0 77.88-32.11Q590-484.23 590-530t-32.12-77.88Q525.77-640 480-640q-45.77 0-77.88 32.12Q370-575.77 370-530q0 45.77 32.12 77.89Q434.23-420 480-420ZM172.31-180Q142-180 121-201q-21-21-21-51.31v-455.38Q100-738 121-759q21-21 51.31-21h615.38Q818-780 839-759q21 21 21 51.31v455.38Q860-222 839-201q-21 21-51.31 21H172.31Zm83.85-60q45-48.31 101.69-74.15Q414.54-340 480-340q65.46 0 122.15 25.85 56.69 25.84 101.69 74.15h83.85q4.62 0 8.46-3.85 3.85-3.84 3.85-8.46v-455.38q0-4.62-3.85-8.46-3.84-3.85-8.46-3.85H172.31q-4.62 0-8.46 3.85-3.85 3.84-3.85 8.46v455.38q0 4.62 3.85 8.46 3.84 3.85 8.46 3.85h83.85Zm91.84 0h264q-29-20-62.5-30T480-280q-36 0-69.5 10T348-240Zm132-240q-20.85 0-35.42-14.57Q430-509.15 430-530q0-20.84 14.58-35.42Q459.15-580 480-580t35.42 14.58Q530-550.84 530-530q0 20.85-14.58 35.43Q500.85-480 480-480Zm0 0Z"></path>
  </svg>
);

const workloads: WorkloadOption[] = [
  { key: 'emails', label: 'Emails', icon: <EmailIcon />, backendType: 'exchange' },
  { key: 'files', label: 'Files & Folders', icon: <FilesFolderIcon />, backendType: 'onedrive' },
  { key: 'chats', label: 'Chats messages', icon: <ChatMessageIcon />, backendType: 'teams' },
  { key: 'channel', label: 'Channel messages', icon: <ChatMessageIcon />, backendType: 'teams' },
  { key: 'copilot', label: 'Copilot messages', icon: <CopilotIcon />, backendType: 'copilot' },
  { key: 'calendar', label: 'Calendar events', icon: <CalendarIcon />, backendType: 'exchange' },
  { key: 'contacts', label: 'Contacts', icon: <ContactsIcon />, backendType: 'exchange' },
  { key: 'exchange', label: 'Exchange tasks', icon: <TasksIcon />, backendType: 'exchange' },
  { key: 'planner', label: 'Planner tasks', icon: <TasksIcon />, backendType: 'planner' },
];

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
  const { tenantId, serviceType } = useParams<{ tenantId: string; serviceType: string }>();
  const [query, setQuery] = useState('');
  const [workload, setWorkload] = useState<WorkloadType>('emails');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Dropdown state
  const [workloadDropdownOpen, setWorkloadDropdownOpen] = useState(false);
  const [scopeDropdownOpen, setScopeDropdownOpen] = useState(false);
  const workloadDropdownRef = useRef<HTMLDivElement>(null);
  const scopeDropdownRef = useRef<HTMLDivElement>(null);

  // Scope state
  const [scopeResources, setScopeResources] = useState<ResourceItem[]>([]);
  const [selectedScope, setSelectedScope] = useState<string>('all');
  const [scopeLoading, setScopeLoading] = useState(false);

  // Restore modal state
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<SearchResult | null>(null);

  // For Azure type, hide workload selector
  const isAzure = serviceType === 'azure';

  // Fetch ENTRA_GROUP resources for scope dropdown (M365 only)
  useEffect(() => {
    if (!isAzure && tenantId && scopeDropdownOpen) {
      fetchScopeResources();
    }
  }, [scopeDropdownOpen, tenantId, isAzure]);

  const fetchScopeResources = async () => {
    if (!tenantId) return;
    setScopeLoading(true);
    try {
      const response = await getResources(tenantId, 'entra-groups', 1, 50, undefined, undefined, undefined, 'm365');
      setScopeResources(response.items);
    } catch (err) {
      console.error('Failed to fetch scope resources:', err);
    } finally {
      setScopeLoading(false);
    }
  };

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (workloadDropdownRef.current && !workloadDropdownRef.current.contains(event.target as Node)) {
        setWorkloadDropdownOpen(false);
      }
      if (scopeDropdownRef.current && !scopeDropdownRef.current.contains(event.target as Node)) {
        setScopeDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSearch = async () => {
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setHasSearched(true);
    setPage(1);

    try {
      const workloadType = workloads.find(w => w.key === workload)?.backendType;
      const response = await SearchService.search(query, {
        tenantId: selectedScope !== 'all' ? selectedScope : undefined,
        workloadType,
        page: 1,
        size: 20,
      });
      setResults(response.results);
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
        tenantId: selectedScope !== 'all' ? selectedScope : undefined,
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
        <div className="search-bar-row">
          <div className="search-input-wrapper">
            <input
              type="text"
              placeholder="Search"
              className="search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button className="filter-icon-btn" title="Advanced filters">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 16, height: 16}}>
                <line x1="4" y1="6" x2="20" y2="6"/>
                <line x1="8" y1="12" x2="20" y2="12"/>
                <line x1="12" y1="18" x2="20" y2="18"/>
                <circle cx="6" cy="6" r="2" fill="currentColor"/>
                <circle cx="10" cy="12" r="2" fill="currentColor"/>
                <circle cx="14" cy="18" r="2" fill="currentColor"/>
              </svg>
            </button>
            <button
              className="search-icon-btn"
              onClick={handleSearch}
              disabled={loading || !query.trim()}
              title="Search"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 16, height: 16}}>
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </button>
          </div>

          <div className="search-controls">
            {!isAzure && (
              <>
                <div className="control-divider" />
                <div className="control-group" ref={workloadDropdownRef}>
                  <span className="control-label">Workload:</span>
                  <button 
                    className="control-dropdown"
                    onClick={() => setWorkloadDropdownOpen(!workloadDropdownOpen)}
                  >
                    <span style={{marginRight: 4, display: 'flex', alignItems: 'center'}}>
                      {workloads.find(w => w.key === workload)?.icon}
                    </span>
                    {workloads.find(w => w.key === workload)?.label || 'Emails'}
                    <svg 
                      viewBox="0 0 24 24" 
                      fill="none" 
                      stroke="currentColor" 
                      strokeWidth="2" 
                      style={{
                        width: 12, 
                        height: 12, 
                        marginLeft: 4,
                        transform: workloadDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.15s'
                      }}
                    >
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </button>
                  
                  {workloadDropdownOpen && (
                    <div className="dropdown-menu">
                      {workloads.map((w) => (
                        <button
                          key={w.key}
                          className={`dropdown-item ${workload === w.key ? 'active' : ''}`}
                          onClick={() => {
                            setWorkload(w.key);
                            setWorkloadDropdownOpen(false);
                          }}
                        >
                          <span className="dropdown-icon">{w.icon}</span>
                          <span className="dropdown-label">{w.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
            
            <div className="control-divider" />
            <div className="control-group" ref={scopeDropdownRef}>
              <span className="control-label">Scope:</span>
              <button 
                className="control-dropdown"
                onClick={() => setScopeDropdownOpen(!scopeDropdownOpen)}
              >
                {selectedScope === 'all' 
                  ? 'All resources' 
                  : scopeResources.find(r => r.id === selectedScope)?.name || 'All resources'}
                <svg 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2" 
                  style={{
                    width: 12, 
                    height: 12, 
                    marginLeft: 4,
                    transform: scopeDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.15s'
                  }}
                >
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
              
              {scopeDropdownOpen && (
                <div className="dropdown-menu scope-dropdown">
                  <button
                    className={`dropdown-item ${selectedScope === 'all' ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedScope('all');
                      setScopeDropdownOpen(false);
                    }}
                  >
                    <span className="dropdown-label">All resources</span>
                  </button>
                  
                  {scopeLoading ? (
                    <div className="dropdown-loading">Loading resources...</div>
                  ) : (
                    <>
                      <div className="dropdown-divider" />
                      {scopeResources.map((resource) => (
                        <button
                          key={resource.id}
                          className={`dropdown-item ${selectedScope === resource.id ? 'active' : ''}`}
                          onClick={() => {
                            setSelectedScope(resource.id);
                            setScopeDropdownOpen(false);
                          }}
                        >
                          <span className="dropdown-label">{resource.name}</span>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {hasSearched && results.length > 0 && (
        <div className="action-buttons">
          <button className="action-btn" disabled>
            Download
          </button>
          <button className="action-btn" disabled>
            Recover
          </button>
        </div>
      )}

      <div className="separator" />

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
            <p className="empty-state-text">Launch a search query to start</p>
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
