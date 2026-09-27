// React binding of the menu store (wix/restaurants/menu-store.ts) — menu browsing and switching
// live there, framework-free; this hook subscribes to one instance per mounted surface. SSR-friendly:
// pass server-fetched menus as `initialMenus` (Astro frontmatter) and no client fetch happens; a SPA
// passes nothing. Astro islands and React SPAs use this; a static page, Vue, or Svelte uses the store.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createMenuStore, type MenuStore } from "../../wix/restaurants/menu-store";
import type { MenuData } from "../../wix/restaurants/types";

export interface UseMenusOptions {
  initialMenus?: MenuData[];
}

export interface UseMenus {
  /** null while the first load is in flight — render skeletons, not an empty state. */
  menus: MenuData[] | null;
  /** Defaults to the first menu once loaded. */
  activeMenuId: string | null;
  setActiveMenuId: (id: string) => void;
  /** The menu to render (its sections/items are display-ordered). */
  activeMenu: MenuData | null;
  error: string | null;
}

export function useMenus({ initialMenus }: UseMenusOptions = {}): UseMenus {
  const ref = useRef<MenuStore | null>(null);
  if (!ref.current) ref.current = createMenuStore({ initialMenus });
  const store = ref.current;
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return { ...state, setActiveMenuId: store.setActiveMenuId };
}
