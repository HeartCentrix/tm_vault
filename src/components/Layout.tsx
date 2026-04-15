import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import ServiceNav from './ServiceNav';
import AddDataSourceModal from './AddDataSourceModal';
import { useTrackNavigation } from '../hooks/useTrackNavigation';
import type { DataSourceType } from '../services/datasource';
import './Layout.css';

export default function Layout() {
  useTrackNavigation();

  const [selectedSource, setSelectedSource] = useState<DataSourceType | null>(() => {
    const raw = localStorage.getItem('selected_datasource');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as DataSourceType;
      if (parsed && parsed.id && parsed.name && (parsed.type === 'm365' || parsed.type === 'azure' || parsed.type === 'kubernetes')) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  });
  const [isAddSourceModalOpen, setIsAddSourceModalOpen] = useState(false);

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
