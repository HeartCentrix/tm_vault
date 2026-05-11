import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import AddDataSourceModal from '../components/AddDataSourceModal';
import { getDataSources, type DataSourceType } from '../services/datasource';
import { MicrosoftLogo, AzureLogo } from '../components/BrandLogos';
import './Tenants.css';

export default function Tenants() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddSource, setShowAddSource] = useState(false);
  const [tenants, setTenants] = useState<DataSourceType[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDataSources()
      .then(setTenants)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filteredTenants = tenants.filter(t =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleTenantClick = (tenant: DataSourceType) => {
    navigate(`/tenants/${tenant.id}/${tenant.type}/overview`);
  };

  return (
    <div className="tenants-page">
      <div className="tenants-actions">
          <input
            type="text"
            placeholder="Search data sources..."
            className="search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button className="add-source-btn" onClick={() => setShowAddSource(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 16, height: 16}}>
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add data source
          </button>
        </div>

      {loading ? (
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
              <tr>
                <td colSpan={4} className="loading-cell">
                  <div className="spinner-dark" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : filteredTenants.length === 0 ? (
        <div className="empty-tenants">
          <h3 className="empty-tenants-title">No data sources connected</h3>
          <p className="empty-tenants-text">Connect your first data source to start protecting your data</p>
          <button className="empty-tenants-btn" onClick={() => setShowAddSource(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 18, height: 18}}>
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add data source
          </button>
        </div>
      ) : (
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
                    {tenant.type === 'm365' ? (
                      <div className="service-icon microsoft">
                        <MicrosoftLogo />
                      </div>
                    ) : tenant.type === 'azure' ? (
                      <div className="service-icon azure">
                        <AzureLogo />
                      </div>
                    ) : null}
                    <span className="tenant-name">{tenant.name}</span>
                  </td>
                  <td>
                    <span className={`service-badge ${tenant.type}`}>
                      {tenant.type.toUpperCase()}
                    </span>
                  </td>
                  <td>
                    <span className="status-badge success">Protected</span>
                  </td>
                  <td>
                    <span className="status-badge success">{tenant.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAddSource && (
        <AddDataSourceModal onClose={() => setShowAddSource(false)} />
      )}
    </div>
  );
}
