// Menu browsing. SSR-friendly: pass server-fetched menus as `initialMenus` (Astro
// frontmatter) and no client fetch happens; a SPA passes nothing. Menu switching is
// client-side (the whole tree is fetched once).
import { useEffect, useMemo, useState } from "react";
import { fetchMenus } from "../../wix/restaurants/menu";
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
  const [menus, setMenus] = useState<MenuData[] | null>(initialMenus ?? null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(initialMenus?.[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!initialMenus) {
      fetchMenus()
        .then((m) => {
          if (!alive) return;
          setMenus(m);
          setActiveMenuId((id) => id ?? m[0]?.id ?? null);
        })
        .catch((e) => {
          if (!alive) return;
          setMenus([]);
          setError(e instanceof Error ? e.message : String(e));
        });
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeMenu = useMemo(() => {
    if (!menus) return null;
    return menus.find((m) => m.id === activeMenuId) ?? menus[0] ?? null;
  }, [menus, activeMenuId]);

  return { menus, activeMenuId: activeMenu?.id ?? null, setActiveMenuId, activeMenu, error };
}
