// REFERENCE menu surface: menu tabs (when >1), section nav, the dish card, and the dish sheet
// (variants, modifier groups, quantity, special request) on the @theme tokens. Correct and
// complete; per the skill's model you design and build your own on useMenus + useOrderCart.
// Note the load-bearing wiring: each card threads its menuId + sectionId from the render context
// into addToOrder — never re-derive them — and every choice goes through the core's selection
// helpers (initialSelection → toggleModifier → validateSelection → addToOrder).
import { useState } from "react";
import { useMenus } from "../../hooks/restaurants/useMenus";
import { useOrderCart } from "../../hooks/restaurants/useOrderCart";
import { imgAttrs } from "../../wix/media";
import { initialSelection, itemPrice, needsSelection, ruleLabel, toggleModifier, validateSelection } from "../../wix/restaurants/menu-core";
import { orderingUnavailableReason } from "../../wix/restaurants/ordering-core";
import { zonedDateTimeLabel } from "../../wix/restaurants/time-core";
import type { MenuData, MenuItem, OrderSelection, SiteMoney } from "../../wix/restaurants/types";

const cta = "rounded-control bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40";
const field = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary";

export interface MenuItemSheetProps {
  item: MenuItem;
  money: SiteMoney;
  busy: boolean;
  onAdd: (quantity: number, selection: OrderSelection) => Promise<void>;
  onClose: () => void;
}

/** The choices on a dish: variant radios, one fieldset per modifier group, quantity, note, live price. */
export function MenuItemSheet({ item, money, busy, onAdd, onClose }: MenuItemSheetProps) {
  const [selection, setSelection] = useState<OrderSelection>(() => initialSelection(item));
  const [quantity, setQuantity] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const price = itemPrice(item, selection, quantity, money);

  const submit = () => {
    const check = validateSelection(item, selection);
    setErrors(check.errors);
    if (!check.ok) return;
    setError(null);
    onAdd(quantity, selection).then(onClose).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <div className="mt-3 rounded-lg border border-border bg-secondary/40 p-4">
      {item.variants.length > 0 && (
        <fieldset className="mb-3">
          <legend className="text-xs font-semibold">Size</legend>
          {item.variants.map((v) => (
            <label key={v.variantId} className="mt-1 flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2">
                <input type="radio" name={`${item.id}-variant`} checked={selection.variantId === v.variantId} onChange={() => setSelection({ ...selection, variantId: v.variantId })} />
                {v.name}
              </span>
              <span className="text-muted-foreground">{v.price}</span>
            </label>
          ))}
        </fieldset>
      )}
      {item.modifierGroups.map((g) => (
        <fieldset key={g.id} className="mb-3">
          <legend className="text-xs font-semibold">
            {g.name} <span className="font-normal text-muted-foreground">· {ruleLabel(g)}</span>
          </legend>
          {g.modifiers.map((m) => {
            const checked = (selection.modifiers[g.id] ?? []).includes(m.key);
            return (
              <label key={m.key} className={`mt-1 flex items-center justify-between gap-3 text-sm ${m.inStock ? "" : "opacity-50"}`}>
                <span className="flex items-center gap-2">
                  <input
                    type={g.singleSelect ? "radio" : "checkbox"}
                    name={`${item.id}-${g.id}`}
                    disabled={!m.inStock}
                    checked={checked}
                    onChange={() => setSelection(toggleModifier(item, selection, g.id, m.key))}
                  />
                  {m.name}
                  {!m.inStock && <span className="text-xs text-muted-foreground">(sold out)</span>}
                </span>
                {m.additionalCharge && <span className="text-muted-foreground">+{m.additionalCharge}</span>}
              </label>
            );
          })}
          {errors[g.id] && <p className="mt-1 text-xs text-destructive">{errors[g.id]}</p>}
        </fieldset>
      ))}
      {item.acceptsSpecialRequests && (
        <label className="mb-3 block text-sm">
          <span className="text-xs font-semibold">Special request</span>
          <textarea rows={2} value={selection.specialRequest} onChange={(e) => setSelection({ ...selection, specialRequest: e.target.value })} className={`mt-1 ${field}`} />
        </label>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-3 rounded-control border border-border px-2 py-0.5">
          <button type="button" aria-label="Decrease quantity" disabled={quantity <= 1} onClick={() => setQuantity(quantity - 1)} className="px-1 text-base disabled:opacity-40">−</button>
          <span className="text-sm tabular-nums">{quantity}</span>
          <button type="button" aria-label="Increase quantity" onClick={() => setQuantity(quantity + 1)} className="px-1 text-base">+</button>
        </div>
        <button type="button" disabled={busy} onClick={submit} className={cta}>
          Add to order{price.formatted ? ` · ${price.formatted}` : ""}
        </button>
        <button type="button" onClick={onClose} className="text-xs text-muted-foreground underline">Cancel</button>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}

export interface MenuItemCardProps {
  item: MenuItem;
  menuId: string;
  sectionId: string;
  money: SiteMoney;
}

export function MenuItemCard({ item, menuId, sectionId, money }: MenuItemCardProps) {
  const { addToOrder, ordering, orderingStatus, menuOrderable, busy } = useOrderCart();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuOk = menuOrderable(menuId);
  // The add control's states, from the data: hidden for a market-priced dish or a menu that takes
  // no online orders now; "Sold out" (the dish, or a required group with nothing in stock);
  // the operation's reason (paused / unavailable); else "Add to order".
  const showControl = !item.marketPrice && menuOk !== false && ordering !== null;
  const unavailable = orderingUnavailableReason(orderingStatus);
  const canAdd = ordering === true && item.orderable && !busy;
  const label = item.soldOut ? "Sold out" : unavailable || "Add to order";
  const pausedUntil =
    orderingStatus?.status === "PAUSED_UNTIL" && orderingStatus.pausedUntilIso
      ? zonedDateTimeLabel(new Date(orderingStatus.pausedUntilIso), orderingStatus.timeZone)
      : "";

  const add = (quantity: number, selection?: OrderSelection) =>
    addToOrder(item, { menuId, sectionId }, quantity, selection).then(() => setError(null));

  return (
    <div id={`item-${item.id}`} className="flex scroll-mt-24 gap-4 rounded-lg border border-border p-4">
      {item.imageUrl && (
        <img
          {...imgAttrs(item.imageUrl, "6rem")}
          alt={item.name}
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
            {item.variants.map((v) => `${v.name} ${v.price}`.trim()).join(" · ")}
          </p>
        )}
        {item.modifierGroups.length > 0 && !open && (
          <p className="mt-1 text-xs text-muted-foreground">Options: {item.modifierGroups.map((g) => g.name).join(", ")}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {showControl && (
            <button
              type="button"
              disabled={!canAdd}
              onClick={() => {
                if (needsSelection(item)) setOpen((o) => !o);
                else add(1).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
              }}
              className={cta}
            >
              {label}
            </button>
          )}
          {pausedUntil && !item.soldOut && <p className="text-xs text-muted-foreground">Back at {pausedUntil}</p>}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        {open && canAdd && <MenuItemSheet item={item} money={money} busy={busy} onAdd={add} onClose={() => setOpen(false)} />}
      </div>
    </div>
  );
}

export interface MenuViewProps {
  initialMenus?: MenuData[];
  emptyMessage?: string;
}

const tab = (active: boolean) =>
  `rounded-control border px-4 py-1.5 text-sm font-medium transition-colors ${
    active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border text-foreground hover:bg-secondary"
  }`;

export default function MenuView({
  initialMenus,
  emptyMessage = "The menu is being written — check back soon.",
}: MenuViewProps) {
  const { menus, activeMenuId, setActiveMenuId, activeMenu, error } = useMenus({ initialMenus });
  const { menuOrderable } = useOrderCart();

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
      {activeMenu && menuOrderable(activeMenu.id) === false && (
        <p className="mb-6 text-sm text-muted-foreground">This menu isn't available for online ordering right now.</p>
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
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
      {activeMenu?.sections.map((section) => (
        <section key={section.id} id={`section-${section.id}`} className="mb-12">
          <h2 className="text-lg font-semibold tracking-tight">{section.name}</h2>
          {section.description && <p className="mt-1 text-sm text-muted-foreground">{section.description}</p>}
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            {section.items.map((item) => (
              <MenuItemCard key={item.id} item={item} menuId={activeMenu.id} sectionId={section.id} money={activeMenu.money} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
