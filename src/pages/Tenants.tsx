import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Tenants.css';

interface Tenant {
  id: string;
  name: string;
  type: 'M365' | 'Azure' | 'Both';
  protectionStatus: string;
  backupStatus: string;
}

const mockTenants: Tenant[] = [
  { id: '1', name: 'Contoso M365', type: 'M365', protectionStatus: 'Protected', backupStatus: 'Success' },
  { id: '2', name: 'Fabrikam Azure', type: 'Azure', protectionStatus: 'Protected', backupStatus: 'Success' },
];

export default function Tenants() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredTenants = mockTenants.filter(t =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleTenantClick = (tenant: Tenant) => {
    const type = tenant.type === 'Both' ? 'M365' : tenant.type;
    navigate(`/tenants/${tenant.id}/${type.toLowerCase()}/overview`);
  };

  return (
    <div className="tenants-page">
      <div className="tenants-header">
        <h1 className="tenants-title">Data Sources</h1>
        <div className="tenants-actions">
          <input
            type="text"
            placeholder="Search data sources..."
            className="search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button className="add-source-btn" onClick={() => alert('Open modal')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 16, height: 16}}>
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add data source
          </button>
        </div>
      </div>

      <div className="tenants-table-container">
        <table className="tenants-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Service</th>
              <th>Protection</th>
              <th>Backup Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredTenants.map((tenant) => (
              <tr key={tenant.id} onClick={() => handleTenantClick(tenant)} className="tenant-row">
                <td className="tenant-name-cell">
                  {tenant.type === 'M365' || tenant.type === 'Both' ? (
                    <div className="service-icon microsoft">
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <rect x="1" y="1" width="10" height="10" fill="#f25022"/>
                        <rect x="13" y="1" width="10" height="10" fill="#7fba00"/>
                        <rect x="1" y="13" width="10" height="10" fill="#00a4ef"/>
                        <rect x="13" y="13" width="10" height="10" fill="#ffb900"/>
                      </svg>
                    </div>
                  ) : (
                    <div className="service-icon azure">
                      <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2L2 19h20L12 2z"/>
                      </svg>
                    </div>
                  )}
                  <span className="tenant-name">{tenant.name}</span>
                </td>
                <td>
                  <span className={`service-badge ${tenant.type === 'Azure' ? 'azure' : 'microsoft'}`}>
                    {tenant.type}
                  </span>
                </td>
                <td>
                  <span className="status-badge success">{tenant.protectionStatus}</span>
                </td>
                <td>
                  <span className="status-badge success">{tenant.backupStatus}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
