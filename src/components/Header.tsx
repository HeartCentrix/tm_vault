import { useState, useEffect, useRef } from 'react';
import './Header.css';

interface DataSource {
  id: string;
  name: string;
  type: 'microsoft365' | 'azure';
  status?: string;
}

interface HeaderProps {
  selectedSource: DataSource | null;
  onSelectSource: (source: DataSource | null) => void;
  onOpenAddSource: () => void;
}

export default function Header({ selectedSource, onSelectSource, onOpenAddSource }: HeaderProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const displaySourceName = selectedSource?.name || 'All data sources';

  // Mock data sources
  const dataSources: DataSource[] = [
    { id: '1', name: 'Contoso M365', type: 'microsoft365', status: 'ACTIVE' },
    { id: '2', name: 'Fabrikam Azure', type: 'azure', status: 'ACTIVE' },
  ];

  const filteredDataSources = dataSources.filter(ds =>
    ds.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectAllDataSources = () => {
    onSelectSource(null);
    setIsDropdownOpen(false);
  };

  const selectDataSource = (source: DataSource) => {
    onSelectSource(source);
    setIsDropdownOpen(false);
  };

  const toggleDropdown = () => {
    setIsDropdownOpen(!isDropdownOpen);
  };

  const toggleUserMenu = () => {
    setIsUserMenuOpen(!isUserMenuOpen);
  };

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <>
      <header className="header">
        <div className="header-left">
          <div className="data-source-selector" ref={dropdownRef}>
            <button className="selector-btn" onClick={toggleDropdown}>
              <svg className="home-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
              <span className="source-name">{displaySourceName}</span>
              <svg className={`dropdown-arrow ${isDropdownOpen ? 'open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>

            {isDropdownOpen && (
              <div className="dropdown-menu">
                {selectedSource && (
                  <div className="dropdown-header">
                    <div className="header-icon microsoft">
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <rect x="1" y="1" width="10" height="10" fill="#f25022"/>
                        <rect x="13" y="1" width="10" height="10" fill="#7fba00"/>
                        <rect x="1" y="13" width="10" height="10" fill="#00a4ef"/>
                        <rect x="13" y="13" width="10" height="10" fill="#ffb900"/>
                      </svg>
                    </div>
                    <span className="header-tenant-name">{selectedSource.name}</span>
                    <button className="collapse-btn" onClick={selectAllDataSources}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="18 15 12 9 6 15"/>
                      </svg>
                    </button>
                  </div>
                )}

                <div className="dropdown-search">
                  <input
                    type="text"
                    placeholder="Search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                <div className="dropdown-section">
                  <div
                    className={`dropdown-item ${!selectedSource ? 'active' : ''}`}
                    onClick={selectAllDataSources}
                  >
                    <svg className="home-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                      <polyline points="9 22 9 12 15 12 15 22"/>
                    </svg>
                    <span>All data sources</span>
                  </div>
                </div>

                {filteredDataSources.length > 0 && (
                  <div className="dropdown-section">
                    <div className="dropdown-label">Data sources</div>
                    {filteredDataSources.map((source) => (
                      <div
                        key={source.id}
                        className={`dropdown-item ${selectedSource?.id === source.id ? 'active' : ''}`}
                        onClick={() => selectDataSource(source)}
                      >
                        {source.type === 'microsoft365' ? (
                          <div className="source-icon microsoft">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                              <rect x="1" y="1" width="10" height="10" fill="#f25022"/>
                              <rect x="13" y="1" width="10" height="10" fill="#7fba00"/>
                              <rect x="1" y="13" width="10" height="10" fill="#00a4ef"/>
                              <rect x="13" y="13" width="10" height="10" fill="#ffb900"/>
                            </svg>
                          </div>
                        ) : (
                          <div className="source-icon azure">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                              <path d="M12 2L2 19h20L12 2z"/>
                            </svg>
                          </div>
                        )}
                        <span>{source.name}</span>
                        {source.status === 'DISCOVERING' && (
                          <span className="status-badge discovering">Discovering</span>
                        )}
                        {source.status === 'ACTIVE' && (
                          <span className="status-badge active">Active</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="dropdown-section">
                  <div className="dropdown-item add-source" onClick={onOpenAddSource}>
                    <svg className="add-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="12" y1="5" x2="12" y2="19"/>
                      <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    <span>Add data source</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="header-right">
          <button className="icon-btn notification-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
          </button>

          <div className="user-menu" ref={userMenuRef}>
            <div className="avatar" onClick={toggleUserMenu}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </div>

            {isUserMenuOpen && (
              <div className="user-dropdown">
                <div className="user-info">
                  <div className="user-name">Admin User</div>
                  <div className="user-email">admin@contoso.com</div>
                </div>
                <div className="dropdown-divider"></div>
                <button className="logout-item" onClick={() => {
                  localStorage.removeItem('access_token');
                  localStorage.removeItem('refresh_token');
                  window.location.href = '/signin';
                }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                    <polyline points="16 17 21 12 16 7"/>
                    <line x1="21" y1="12" x2="9" y2="12"/>
                  </svg>
                  <span>Logout</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
    </>
  );
}
