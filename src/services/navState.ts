interface NavigationState {
  tenantId: string | null;
  serviceType: string | null;
  subRoute: string; // e.g. '/overview', '/protection', '/protection/settings'
  /** Per-page tab states keyed by subRoute, e.g. { '/protection': 'shared', '/protection/settings': 'info' } */
  tabStates: Record<string, string>;
}

const STORAGE_KEY = 'tm_vault_nav_state';

/**
 * Resolve the storage key for a page's tab state.
 * Maps subRoute to a key. For nested routes like /protection/settings,
 * we use the full path as the key.
 */
function tabKey(subRoute: string): string {
  return subRoute || '/overview';
}

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
    const parsed = JSON.parse(raw);
    // Ensure tabStates exists for backward compatibility
    if (!parsed.tabStates) {
      parsed.tabStates = {};
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Save the tab state for a specific page/subRoute.
 * @param subRouteKey - The key to identify this page's tab state (e.g. '/protection', '/protection/settings')
 * @param tabValue - The tab value to save (e.g. 'shared', 'info')
 */
export function saveTabState(subRouteKey: string, tabValue: string): void {
  try {
    const state = getNavigationState();
    if (state) {
      state.tabStates = state.tabStates || {};
      state.tabStates[subRouteKey] = tabValue;
      saveNavigationState(state);
    }
  } catch {
    // Ignore
  }
}

/**
 * Get the saved tab for a specific page/subRoute.
 * Returns the saved tab value or null if none is saved.
 * @param subRouteKey - The key to look up (e.g. '/protection', '/protection/settings')
 */
export function getSavedTab(subRouteKey: string): string | null {
  try {
    const state = getNavigationState();
    if (!state?.tabStates) return null;
    return state.tabStates[subRouteKey] || null;
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
