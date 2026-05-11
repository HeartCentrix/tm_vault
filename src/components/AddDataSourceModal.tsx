import { authService } from '../services/auth';
import { MicrosoftLogo, AzureLogo } from './BrandLogos';

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
                <MicrosoftLogo size={48} />
              </div>
              <span className="source-name">Microsoft 365</span>
              <button className="source-btn microsoft" onClick={handleM365Connect}>Connect</button>
            </div>

            <div className="data-source-item">
              <div className="source-logo azure">
                <AzureLogo size={48} />
              </div>
              <span className="source-name">Azure</span>
              <button className="source-btn azure" onClick={handleAzureConnect}>Connect</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
