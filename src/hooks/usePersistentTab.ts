import { useState, useEffect, useCallback } from 'react';
import { getSavedTab, saveTabState } from '../services/navState';

/**
 * A hook that persists tab state in localStorage.
 *
 * - On mount, restores the saved tab for the given subRouteKey.
 * - On tab change, saves the new tab value.
 * - Validates that the restored tab is in the allowedTabs list; falls back to defaultTab if not.
 *
 * @param subRouteKey - Unique key for this page's tab state (e.g. '/protection', '/protection/settings')
 * @param defaultTab - The default tab to use if no tab is saved or saved tab is invalid
 * @param allowedTabs - Array of valid tab values (used for cross-serviceType validation)
 */
export function usePersistentTab<T extends string>(
  subRouteKey: string,
  defaultTab: T,
  allowedTabs: readonly T[],
): [T, (tab: T) => void] {
  const [activeTab, setActiveTab] = useState<T>(() => {
    const saved = getSavedTab(subRouteKey);
    if (saved && (allowedTabs as string[]).includes(saved)) {
      return saved as T;
    }
    return defaultTab;
  });

  const setTab = useCallback((tab: T) => {
    setActiveTab(tab);
    saveTabState(subRouteKey, tab);
  }, [subRouteKey]);

  // When the current tab is not in the allowed tabs (e.g. switching serviceType),
  // fall back to the default tab and persist it.
  useEffect(() => {
    if (!(allowedTabs as string[]).includes(activeTab)) {
      setActiveTab(defaultTab);
      saveTabState(subRouteKey, defaultTab);
    }
  }, [activeTab, defaultTab, allowedTabs, subRouteKey]);

  return [activeTab, setTab];
}
