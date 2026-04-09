interface NavigationState {
  tenantId: string | null;
  serviceType: string | null;
  subRoute: string; // e.g. '/overview', '/protection', '/protection/settings'
}

const STORAGE_KEY = 'tm_vault_nav_state';

export function saveNavigationState(state: NavigationState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage errors
  }
}

export function getNavigationState(): NavigationState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearNavigationState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }
}
