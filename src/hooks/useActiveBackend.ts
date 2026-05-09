import { useEffect, useState } from 'react';
import { AdminStorageService, type StorageBackend } from '../services/adminStorage';

export interface ActiveBackend {
  kind: string;            // 'azure_blob' | 'seaweedfs'
  name: string;            // 'azure-primary' / 'seaweedfs-local'
  endpoint?: string;
  loading: boolean;
  error?: string;
}

const FALLBACK: StorageBackend = {
  id: '', kind: 'unknown', name: 'unknown', endpoint: '', is_enabled: false,
};

// Lightweight read of the currently-active storage backend. Used by the
// SLA wizard to gate Azure-only options (BYOK, WORM) and to show a
// "Backup destination" banner so operators see what their policy will
// actually write to.
export function useActiveBackend(): ActiveBackend {
  const [state, setState] = useState<ActiveBackend>({
    kind: '', name: '', loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    AdminStorageService.status()
      .then(s => {
        if (cancelled) return;
        const ab = s.active_backend ?? FALLBACK;
        setState({ kind: ab.kind, name: ab.name, endpoint: ab.endpoint, loading: false });
      })
      .catch(e => {
        if (cancelled) return;
        // Non-fatal: wizard still works; just falls back to "show all options"
        // (treated as Azure for option-gating purposes).
        setState({ kind: '', name: '', loading: false, error: e?.message || String(e) });
      });
    return () => { cancelled = true; };
  }, []);

  return state;
}
