import { authService } from '../services/auth';

interface AddDataSourceModalProps {
  onClose: () => void;
}

export default function AddDataSourceModal({ onClose }: AddDataSourceModalProps) {
  const handleM365Connect = async () => {
    try {
      const { url } = await authService.getDatasourceUrl();
      window.location.href = url;
    } catch (err: any) {
      console.error('Failed to get M365 datasource URL:', err);
    }
  };

  const handleAzureConnect = async () => {
    try {
      const { url } = await authService.getAzureDatasourceUrl();
      window.location.href = url;
    } catch (err: any) {
      console.error('Failed to get Azure datasource URL:', err);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        <div className="modal-header">
          <h3 className="modal-title">Add Data Source</h3>
        </div>

        <div className="modal-body">
          <div className="data-sources-grid">
            <div className="data-source-item">
              <div className="source-logo microsoft365">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <rect x="1" y="1" width="10" height="10" fill="#f25022"/>
                  <rect x="13" y="1" width="10" height="10" fill="#7fba00"/>
                  <rect x="1" y="13" width="10" height="10" fill="#00a4ef"/>
                  <rect x="13" y="13" width="10" height="10" fill="#ffb900"/>
                </svg>
              </div>
              <span className="source-name">Microsoft 365</span>
              <button className="source-btn microsoft" onClick={handleM365Connect}>Connect</button>
            </div>

            <div className="data-source-item">
              <div className="source-logo azure">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2L2 19h20L12 2z"/>
                </svg>
              </div>
              <span className="source-name">Azure</span>
              <button className="source-btn azure" onClick={handleAzureConnect}>Connect</button>
            </div>

            <div className="data-source-item">
              <div className="source-logo kubernetes">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                </svg>
              </div>
              <span className="source-name">Kubernetes</span>
              <button className="source-btn kubernetes" disabled>Coming Soon</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
