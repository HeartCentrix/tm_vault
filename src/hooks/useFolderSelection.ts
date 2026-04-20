import { useCallback, useMemo, useState } from 'react';

/**
 * Folder + item selection state for the Recovery page middle panel
 * (OneDrive / SharePoint / Teams Files / Groups Files).
 *
 * Backend contract (see docs/superpowers/specs/2026-04-20-files-folder-select-design.md):
 *   - `folderPaths`      — folders ticked; server expands to every descendant
 *   - `itemIds`          — files ticked individually (no folder in scope)
 *   - `excludedItemIds`  — files un-ticked inside a ticked folder
 *
 * Selection semantics (Finder-like):
 *   - Ticking a folder adds its path to `selectedFolders`; every
 *     descendant then renders as checked via `isDescendantOfSelected`.
 *   - Unticking an already-ticked folder removes it from the set.
 *   - Unticking a folder whose ancestor is ticked removes the ancestor
 *     and re-adds the ancestor's remaining siblings, preserving the
 *     original selection shape without a server round-trip.
 *   - Ticking an already-ticked folder-descendant file is a no-op.
 *     Unticking a file inside a ticked folder adds it to
 *     `excludedItems`; the server subtracts it from the resolver output.
 */

type FolderRow = { path?: string; count?: number };

const norm = (p: string): string => {
  if (!p) return '/';
  const trimmed = p.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
};

export function useFolderSelection(folderTree: FolderRow[] = []) {
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [excludedItems, setExcludedItems] = useState<Set<string>>(new Set());

  const normalisedPaths = useMemo(
    () => folderTree.map((f) => norm(f.path || '/')),
    [folderTree],
  );

  const isDescendantOfSelected = useCallback(
    (path: string): boolean => {
      const p = norm(path);
      for (const sel of selectedFolders) {
        if (p === sel) return true;
        if (sel === '/' && p !== '/') return true;
        if (p.startsWith(sel + '/')) return true;
      }
      return false;
    },
    [selectedFolders],
  );

  const siblingsOf = useCallback(
    (path: string): string[] => {
      const p = norm(path);
      if (p === '/') return [];
      const i = p.lastIndexOf('/');
      const parentPrefix = i <= 0 ? '/' : p.slice(0, i);
      const depth = p.split('/').length;
      return normalisedPaths.filter((candidate) => {
        if (candidate === p) return false;
        if (candidate.split('/').length !== depth) return false;
        if (parentPrefix === '/') {
          // Top-level sibling: exactly one slash at position 0.
          return candidate.startsWith('/') && !candidate.slice(1).includes('/');
        }
        return candidate.startsWith(parentPrefix + '/');
      });
    },
    [normalisedPaths],
  );

  const toggleFolder = useCallback(
    (rawPath: string) => {
      const path = norm(rawPath);
      setSelectedFolders((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          // Direct un-tick of a folder the user had explicitly ticked.
          next.delete(path);
          return next;
        }
        // Un-tick of a descendant whose ancestor is in the set — find
        // the highest ticked ancestor and replace it with the siblings
        // along the path back down.
        let ancestor: string | null = null;
        let p = path;
        while (p !== '/') {
          const i = p.lastIndexOf('/');
          p = i <= 0 ? '/' : p.slice(0, i);
          if (next.has(p)) {
            ancestor = p;
            break;
          }
        }
        if (ancestor === null && next.has('/')) ancestor = '/';

        if (ancestor !== null) {
          next.delete(ancestor);
          // Walk from ancestor down towards path, adding siblings at
          // each level so the pre-untick shape minus `path` remains.
          let cursor = path;
          while (cursor !== ancestor) {
            for (const sib of siblingsOf(cursor)) next.add(sib);
            const i = cursor.lastIndexOf('/');
            cursor = i <= 0 ? '/' : cursor.slice(0, i);
          }
          return next;
        }

        // Fresh tick.
        next.add(path);
        return next;
      });
    },
    [siblingsOf],
  );

  const toggleItem = useCallback((id: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleFileUnderSelectedFolder = useCallback((id: string) => {
    setExcludedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setSelectedFolders(new Set());
    setSelectedItems(new Set());
    setExcludedItems(new Set());
  }, []);

  const payload = useCallback(
    () => ({
      itemIds: Array.from(selectedItems),
      folderPaths: Array.from(selectedFolders),
      excludedItemIds: Array.from(excludedItems),
      preserveTree: selectedFolders.size > 0,
    }),
    [selectedItems, selectedFolders, excludedItems],
  );

  return {
    selectedFolders,
    selectedItems,
    excludedItems,
    toggleFolder,
    toggleItem,
    toggleFileUnderSelectedFolder,
    isDescendantOfSelected,
    siblingsOf,
    clear,
    payload,
  };
}

export type UseFolderSelection = ReturnType<typeof useFolderSelection>;
