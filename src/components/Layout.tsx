import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import ServiceNav from './ServiceNav';
import AddDataSourceModal from './AddDataSourceModal';
import './Layout.css';
import { getDataSources } from '../services/datasource';
import type { DataSourceType } from '../services/datasource';

export default function Layout() {
  const [selectedSource, setSelectedSource] = useState<DataSourceType | null>(null);
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
