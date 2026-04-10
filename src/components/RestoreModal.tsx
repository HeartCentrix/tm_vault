import { useState } from 'react';
import './RestoreModal.css';
import { RestoreService, type RestoreType } from '../services/restore';

interface RestoreModalProps {
  isOpen: boolean;
  onClose: () => void;
  itemIds: string[];
  snapshotIds: string[];
  itemName?: string;
  itemType?: string;
}

const RESTORE_TYPES: { key: RestoreType; label: string; description: string }[] = [
  {
    key: 'IN_PLACE',
    label: 'In-place restore',
    description: 'Restore items to their original location',
  },
  {
    key: 'CROSS_USER',
    label: 'Cross-user restore',
    description: 'Restore items to a different user/resource',
  },
  {
    key: 'EXPORT_ZIP',
    label: 'Export as ZIP',
    description: 'Download items as a ZIP file',
  },
  {
    key: 'DOWNLOAD',
    label: 'Download JSON',
    description: 'Download items as JSON data',
  },
];

export function RestoreModal({ isOpen, onClose, itemIds, snapshotIds, itemName, itemType }: RestoreModalProps) {
  const [restoreType, setRestoreType] = useState<RestoreType>('IN_PLACE');
  const [targetUserId, setTargetUserId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ jobId: string; restoreType: string } | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (restoreType === 'CROSS_USER' && !targetUserId.trim()) {
      setError('Target user ID is required for cross-user restore');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await RestoreService.triggerRestore({
        restoreType,
        snapshotIds,
        itemIds,
        targetUserId: restoreType === 'CROSS_USER' ? targetUserId : undefined,
      });

      setSuccess({ jobId: response.jobId, restoreType: response.restoreType });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>Restore Queued</h2>
            <button className="modal-close" onClick={onClose}>×</button>
          </div>
          <div className="modal-body">
            <div className="success-message">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{width: 48, height: 48, color: '#38a169'}}>
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <p>Restore job has been queued successfully</p>
              <p><strong>Job ID:</strong> {success.jobId}</p>
              <p><strong>Type:</strong> {success.restoreType}</p>
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn-primary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Restore Items</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {itemName && (
            <div className="restore-item-info">
              <strong>Item:</strong> {itemName}
              {itemType && <span> ({itemType})</span>}
            </div>
          )}

          <div className="form-group">
            <label>Restore Type</label>
            <div className="restore-type-options">
              {RESTORE_TYPES.map(type => (
                <label
                  key={type.key}
                  className={`restore-type-option ${restoreType === type.key ? 'selected' : ''}`}
                >
                  <input
                    type="radio"
                    name="restoreType"
                    value={type.key}
                    checked={restoreType === type.key}
                    onChange={() => setRestoreType(type.key)}
                  />
                  <div className="restore-type-label">
                    <strong>{type.label}</strong>
                    <span>{type.description}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {restoreType === 'CROSS_USER' && (
            <div className="form-group">
              <label>Target User ID</label>
              <input
                type="text"
                value={targetUserId}
                onChange={(e) => setTargetUserId(e.target.value)}
                placeholder="Enter target user external ID"
                className="form-input"
              />
            </div>
          )}

          {error && <div className="error-message">{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? 'Submitting...' : 'Restore'}
          </button>
        </div>
      </div>
    </div>
  );
}
