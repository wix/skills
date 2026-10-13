// Menu browsing as a framework-free store — the logic behind useMenus, usable from React (useMenus
// wraps it with useSyncExternalStore), from a static page or Vue/Svelte (subscribe and render), or
// as the specification for a port. Same shape as order-store.ts: state, actions, subscribe/getState,
// emit after every change. The whole tree is fetched once; menu switching is local.
//
// SSR-friendly: seed with `initialMenus` (Astro frontmatter) and no fetch happens; a SPA passes
// nothing and `start()` fetches. One store per mounted menu surface: createMenuStore(), not a
// singleton (the order cart is the singleton — one per visitor).
import { fetchMenus } from "./menu";
import type { MenuData } from "./types";

export interface MenuStoreOptions {
  initialMenus?: MenuData[];
}

/** Everything a menu surface renders from. Read it with getState() or through a subscription. */
export interface MenuState {
  /** null while the first load is in flight — render skeletons, not an empty state. */
  menus: MenuData[] | null;
  /** Defaults to the first menu once loaded. */
  activeMenuId: string | null;
  /** The menu to render (its sections/items are display-ordered). */
  activeMenu: MenuData | null;
  error: string | null;
}

export interface MenuStore {
  getState(): MenuState;
  subscribe(listener: () => void): () => void;
  /** Fetch the tree when no `initialMenus` were given. Call once when mounted. */
  start(): void;
  /** Stop reacting; drop a late response. */
  stop(): void;
  setActiveMenuId(id: string): void;
}

export function createMenuStore({ initialMenus }: MenuStoreOptions = {}): MenuStore {
  let menus: MenuData[] | null = initialMenus ?? null;
  let selectedId: string | null = initialMenus?.[0]?.id ?? null;
  let error: string | null = null;
  let started = false;
  const listeners = new Set<() => void>();
  let snapshot: MenuState | null = null;
  const emit = () => {
    snapshot = null;
    for (const fn of listeners) fn();
  };

  function getState(): MenuState {
    if (snapshot) return snapshot;
    const activeMenu = menus ? (menus.find((m) => m.id === selectedId) ?? menus[0] ?? null) : null;
    snapshot = { menus, activeMenuId: activeMenu?.id ?? null, activeMenu, error };
    return snapshot;
  }

  return {
    getState,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    start() {
      if (started) return;
      started = true;
      if (initialMenus) return;
      fetchMenus()
        .then((m) => {
          if (!started) return;
          menus = m;
          selectedId ??= m[0]?.id ?? null;
          emit();
        })
        .catch((e) => {
          if (!started) return;
          menus = [];
          error = e instanceof Error ? e.message : String(e);
          emit();
        });
    },
    stop() {
      started = false;
    },
    setActiveMenuId(id) {
      if (id === selectedId) return;
      selectedId = id;
      emit();
    },
  };
}
