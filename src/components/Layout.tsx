import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import ServiceNav from './ServiceNav';
import AddDataSourceModal from './AddDataSourceModal';
import { useTrackNavigation } from '../hooks/useTrackNavigation';
import { getDataSources, type DataSourceType } from '../services/datasource';
import './Layout.css';

export default function Layout() {
  useTrackNavigation();

  const location = useLocation();
  const [selectedSource, setSelectedSource] = useState<DataSourceType | null>(() => {
    const raw = localStorage.getItem('selected_datasource');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as DataSourceType;
      if (parsed && parsed.id && parsed.name && (parsed.type === 'm365' || parsed.type === 'azure')) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  });
  const [isAddSourceModalOpen, setIsAddSourceModalOpen] = useState(false);

  // Sync selectedSource from URL (e.g. when navigating from Tenants page)
  useEffect(() => {
    const match = location.pathname.match(/^\/tenants\/([^/]+)\/([^/]+)/);
    if (!match) {
      setSelectedSource(null);
      return;
    }
    const [, tenantId, serviceType] = match;
    getDataSources().then((sources) => {
      const found = sources.find((s) => s.id === tenantId && s.type === serviceType);
      if (found) setSelectedSource(found);
    }).catch(console.error);
  }, [location.pathname]);

  return (
    <>
      <Sidebar />
      <Header
        selectedSource={selectedSource}
        onSelectSource={setSelectedSource}
        onOpenAddSource={() => setIsAddSourceModalOpen(true)}
      />
      <main className="main-content">
        <ServiceNav />
        <Outlet />
      </main>

      {isAddSourceModalOpen && (
        <AddDataSourceModal onClose={() => setIsAddSourceModalOpen(false)} />
      )}
    </>
  );
}
