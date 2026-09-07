// REFERENCE menu surface: menu tabs (when >1), section nav, and the dish card, on the
// @theme tokens. Correct and complete; per the skill's model you design and build your own
// on useMenus + useOrderCart. Note the load-bearing wiring: each card threads its menuId +
// sectionId from the render context into addToOrder — never re-derive them.
import { useState } from "react";
import { useMenus } from "../../hooks/restaurants/useMenus";
import { useOrderCart } from "../../hooks/restaurants/useOrderCart";
import type { MenuData, MenuItem } from "../../wix/restaurants/types";

export interface MenuItemCardProps {
  item: MenuItem;
  menuId: string;
  sectionId: string;
}

export function MenuItemCard({ item, menuId, sectionId }: MenuItemCardProps) {
  const { addToOrder, ordering, busy } = useOrderCart();
  const [error, setError] = useState<string | null>(null);
  const canAdd = ordering === true && item.inStock && !item.marketPrice && !busy;

  return (
    <div className="flex gap-4 rounded-lg border border-border p-4">
      {item.imageUrl && (
        <img
          src={item.imageUrl}
          alt={item.name}
          loading="lazy"
          className="h-24 w-24 flex-shrink-0 rounded-md bg-secondary object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold">{item.name}</p>
          <p className="whitespace-nowrap text-sm text-foreground">
            {item.marketPrice ? "Market price" : (item.price ?? "")}
          </p>
        </div>
        {item.labels.length > 0 && (
          <p className="mt-0.5 text-xs text-muted-foreground">{item.labels.map((l) => l.name).join(" · ")}</p>
        )}
        {item.description && (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
        )}
        {item.variants.length > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            {item.variants.map((v) => `${v.name} ${v.price}`).join(" · ")}
          </p>
        )}
        {item.modifierGroups.length > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            {/* Modifier groups are DISPLAY-ONLY — selections aren't sent on the cart line. */}
            Options: {item.modifierGroups.map((g) => g.name).join(", ")}
          </p>
        )}
        <div className="mt-2 flex items-center gap-3">
          {ordering !== null && !item.marketPrice && (
            <button
              type="button"
              disabled={!canAdd}
              onClick={() =>
                addToOrder(item.id, { menuId, sectionId }).catch((e: unknown) =>
                  setError(e instanceof Error ? e.message : String(e)),
                )
              }
              className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {!item.inStock ? "Sold out" : ordering === false ? "Ordering unavailable" : "Add to order"}
            </button>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      </div>
    </div>
  );
}

export interface MenuViewProps {
  initialMenus?: MenuData[];
  emptyMessage?: string;
}

const tab = (active: boolean) =>
  `rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
    active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border text-foreground hover:bg-secondary"
  }`;

export default function MenuView({
  initialMenus,
  emptyMessage = "The menu is being written — check back soon.",
}: MenuViewProps) {
  const { menus, activeMenuId, setActiveMenuId, activeMenu, error } = useMenus({ initialMenus });

  if (menus === null) {
    return (
      <div aria-busy="true">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="mb-4 h-24 animate-pulse rounded-lg bg-secondary" />
        ))}
      </div>
    );
  }
  if (menus.length === 0) {
    return <p className="py-16 text-center text-muted-foreground">{error ?? emptyMessage}</p>;
  }

  return (
    <div>
      {menus.length > 1 && (
        <div className="mb-8 flex flex-wrap gap-2" role="group" aria-label="Menus">
          {menus.map((m) => (
            <button key={m.id} type="button" className={tab(m.id === activeMenuId)} onClick={() => setActiveMenuId(m.id)}>
              {m.name}
            </button>
          ))}
        </div>
      )}
      {activeMenu && activeMenu.sections.length > 1 && (
        <nav className="mb-8 flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-label="Sections">
          {activeMenu.sections.map((s) => (
            <a key={s.id} href={`#section-${s.id}`} className="text-muted-foreground no-underline transition-colors hover:text-foreground">
              {s.name}
            </a>
          ))}
        </nav>
      )}
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {activeMenu?.sections.map((section) => (
        <section key={section.id} id={`section-${section.id}`} className="mb-12">
          <h2 className="text-lg font-semibold tracking-tight">{section.name}</h2>
          {section.description && <p className="mt-1 text-sm text-muted-foreground">{section.description}</p>}
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            {section.items.map((item) => (
              <MenuItemCard key={item.id} item={item} menuId={activeMenu.id} sectionId={section.id} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
