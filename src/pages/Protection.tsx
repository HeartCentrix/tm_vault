import { useState } from 'react';
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
];

const mockResources: Resource[] = [
  { id: '1', name: 'John Doe', type: 'Mailbox', status: 'Protected', sla: 'Gold', lastBackup: '2 min ago' },
  { id: '2', name: 'Jane Smith', type: 'OneDrive', status: 'Protected', sla: 'Silver', lastBackup: '1 hour ago' },
  { id: '3', name: 'info@contoso.com', type: 'Shared Mailbox', status: 'Protected', sla: 'Gold', lastBackup: '3 hours ago' },
  { id: '4', name: 'Conf Room A', type: 'Room Mailbox', status: 'Not Protected', lastBackup: '-' },
  { id: '5', name: 'Marketing Site', type: 'SharePoint', status: 'Protected', sla: 'Bronze', lastBackup: '6 hours ago' },
];

export default function Protection() {
  const [activeTab, setActiveTab] = useState<ResourceTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedResources, setSelectedResources] = useState<string[]>([]);

  const filteredResources = mockResources.filter(r =>
    r.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleSelectAll = () => {
    if (selectedResources.length === filteredResources.length) {
      setSelectedResources([]);
    } else {
      setSelectedResources(filteredResources.map(r => r.id));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedResources(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  return (
    <div className="protection-page">
      <div className="protection-header">
        <h1 className="protection-title">Protection</h1>
      </div>

      {/* Tabs */}
      <div className="resource-tabs">
        {tabs.map(tab => (
          <button
            key={tab.key}
            className={`resource-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Action Bar */}
      <div className="action-bar">
        <input
          type="text"
          placeholder="Search resources..."
          className="search-input"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <div className="action-buttons">
          <button className="action-btn secondary">Backup Now</button>
          <button className="action-btn secondary">Assign SLA</button>
          <button className="action-btn primary">Recover</button>
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
                  checked={selectedResources.length === filteredResources.length && filteredResources.length > 0}
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
            {filteredResources.map((resource) => (
              <tr key={resource.id}>
                <td className="checkbox-cell">
                  <input
                    type="checkbox"
                    checked={selectedResources.includes(resource.id)}
                    onChange={() => toggleSelect(resource.id)}
                  />
                </td>
                <td className="resource-name">{resource.name}</td>
                <td>{resource.type}</td>
                <td>
                  {resource.sla ? (
                    <span className={`sla-badge sla-${resource.sla.toLowerCase()}`}>{resource.sla}</span>
                  ) : (
                    <span className="sla-none">None</span>
                  )}
                </td>
                <td>
                  <span className={`status-badge ${resource.status === 'Protected' ? 'success' : 'warning'}`}>
                    {resource.status}
                  </span>
                </td>
                <td className="text-muted">{resource.lastBackup}</td>
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
