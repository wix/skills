// Menu rules and DTO mapping — transport-agnostic, imported by BOTH transports: ./menu.ts (the
// SDK, managed Astro and React) and the REST twin in templates/restaurants/rest/menu.ts (fetch,
// a static site or a port to another language). The hierarchy is Menu → Sections → Items wired by
// ID ARRAYS: display structure and order live in menu.sectionIds / section.itemIds, never in a
// list response's order — the tree is stitched here in id-array order and dangling ids dropped.
// The modifier rule engine (rule type, single-select, pre-selection, validation, sold-out from a
// required group, duplicate ids, live price) mirrors Wix's own ordering code and lives here once.
// A raw entity carries `_id` (SDK) or `id` (REST); every mapper accepts both. Imports are
// type-only so a strip to JS emits no imports.
import type {
  MenuData,
  MenuItem,
  MenuItemLabel,
  MenuItemVariant,
  MenuModifier,
  MenuModifierGroup,
  MenuSection,
  ModifierRuleType,
  OrderSelection,
  SelectionPrice,
  SelectionValidation,
  SiteMoney,
} from "./types";

/** A raw Menus V1 entity as either transport returns it. */
export type Raw = Record<string, any>;
/** Media value + size → https URL. Injected: the SDK transport scales through @wix/sdk, REST through the URL form. */
export type ImgSrc = (value: any, width: number, height: number) => string;

/** An entity's id, or a bare id string (item.labels may be string ids or { _id } refs). */
export const rawId = (raw: Raw | string | undefined | null): string =>
  typeof raw === "string" ? raw : (raw?._id ?? raw?.id ?? "");

/** Index raw entities by id (either spelling). */
export const byId = (arr: Raw[]): Map<string, Raw> => new Map(arr.map((e) => [rawId(e), e]));

const unique = (ids: string[]): string[] => [...new Set(ids.filter(Boolean))];

/** Split an id array for `?ids=…` reads — 100 per call keeps the query string well under the limit. */
export function chunk<T>(arr: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** The next page's cursor of a list response (pagingMetadata.cursors.next), null on the last page. */
export const nextCursor = (res: Raw | null | undefined): string | null => res?.pagingMetadata?.cursors?.next || null;

// ---- money -------------------------------------------------------------------------------------------

/**
 * The site's currency + locale from the eCommerce settings' BUSINESS_INFO (ecommerceSettings.
 * businessInfo.currency / .locale.language / .locale.country), the read Wix's own menus code makes.
 * Nothing is assumed: an unreadable response yields currency "" and every price formats to "".
 */
export function toSiteMoney(settingsRes: Raw | null | undefined): SiteMoney {
  const info: Raw = settingsRes?.ecommerceSettings?.businessInfo ?? {};
  const language = info.locale?.language ?? "";
  const country = info.locale?.country ?? "";
  return { currency: info.currency ?? "", locale: language ? (country ? `${language}-${country}` : language) : "" };
}

/**
 * Format a decimal amount in the site's currency and locale. Prefers a platform-formatted string
 * when the API sent one; "" when the amount is missing or the currency is unknown — never an
 * invented symbol, never a USD default.
 */
export function formatPrice(amount: string | number | null | undefined, money: SiteMoney, platformFormatted?: string | null): string {
  if (platformFormatted) return platformFormatted;
  if (amount == null || amount === "" || !money.currency) return "";
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  try {
    return new Intl.NumberFormat(money.locale || undefined, { style: "currency", currency: money.currency }).format(n);
  } catch {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: money.currency }).format(n);
    } catch {
      return `${n.toFixed(2)} ${money.currency}`;
    }
  }
}

// ---- id collection for the second and third reads ---------------------------------------------

/** The variant ids the items reference — the second read's `variantIds`. */
export function collectVariantIds(items: Raw[]): string[] {
  return unique(items.flatMap((i) => ((i.priceVariants?.variants ?? []) as Raw[]).map((v) => v.variantId)));
}

/** The modifier-group ids the items reference — the second read's `modifierGroupIds`. */
export function collectGroupIds(items: Raw[]): string[] {
  return unique(items.flatMap((i) => ((i.modifierGroups ?? []) as Raw[]).map(rawId)));
}

/** The modifier ids the groups reference — the third read's `modifierIds`. */
export function collectModifierIds(groups: Raw[]): string[] {
  return unique(groups.flatMap((g) => ((g.modifiers ?? []) as Raw[]).map(rawId)));
}

/** Whether any item carries a label — the labels list is read only then. */
export function anyLabels(items: Raw[]): boolean {
  return items.some((i) => ((i.labels ?? []) as Raw[]).length > 0);
}

// ---- modifier rule engine (mirrors Wix's ordering utils) ----------------------------------------

/** required && min 1 && max 1 — the one rule rendered as radios; a new pick replaces the old. */
export const isSingleSelectRule = (rule: { required: boolean; minSelections: number; maxSelections: number | null }): boolean =>
  rule.required && rule.minSelections === 1 && rule.maxSelections === 1;

/** The rule's shape, in Wix's precedence (NO_LIMIT → CHOOSE_ONE → CHOOSE_X → AT_LEAST_ONE → AT_LEAST_X → UP_TO_X → BETWEEN). */
export function ruleType(rule: { required: boolean; minSelections: number; maxSelections: number | null }): ModifierRuleType {
  const { required, minSelections: min, maxSelections: max } = rule;
  if (!required && min < 1 && (max ? max < 1 : true)) return "NO_LIMIT";
  if ((required && min === 1 && max === 1) || (!required && min === 0 && max === 1)) return "CHOOSE_ONE";
  if (required && max && min === max) return "CHOOSE_X";
  if (required && min === 1 && max == null) return "CHOOSE_AT_LEAST_ONE";
  if (required && min > 1 && max == null) return "CHOOSE_AT_LEAST_X";
  if (!required && min === 0 && max && max > 1) return "CHOOSE_UP_TO_X";
  if (required && max && min > 0 && max > min) return "CHOOSE_BETWEEN_X_AND_Y";
  return "NO_LIMIT";
}

/** Human wording of a group's rule for the sheet ("Choose 1", "Choose up to 3", …). */
export function ruleLabel(group: MenuModifierGroup): string {
  const { minSelections: min, maxSelections: max } = group;
  switch (group.rule) {
    case "CHOOSE_ONE": return group.required ? "Choose 1" : "Choose up to 1";
    case "CHOOSE_X": return `Choose ${min}`;
    case "CHOOSE_AT_LEAST_ONE": return "Choose at least 1";
    case "CHOOSE_AT_LEAST_X": return `Choose at least ${min}`;
    case "CHOOSE_UP_TO_X": return `Choose up to ${max}`;
    case "CHOOSE_BETWEEN_X_AND_Y": return `Choose ${min} to ${max}`;
    default: return "Optional";
  }
}

/** A required group whose in-stock modifiers can't reach minSelections makes the whole item unorderable. */
export function requiredGroupOutOfStock(groups: MenuModifierGroup[]): boolean {
  return groups.some((g) => g.required && g.modifiers.filter((m) => m.inStock).length < Math.max(g.minSelections, 0));
}

/** The cheapest variant — the default the sheet opens on; null for a flat-priced item. */
export function defaultVariantId(item: Pick<MenuItem, "variants">): string | null {
  if (!item.variants.length) return null;
  return item.variants.reduce((cheapest, v) => (Number(v.priceAmount) < Number(cheapest.priceAmount) ? v : cheapest)).variantId;
}

/** The selection a sheet opens with: preSelected && inStock modifiers (single-select takes the first), the cheapest variant, no note. */
export function initialSelection(item: Pick<MenuItem, "variants" | "modifierGroups">): OrderSelection {
  const modifiers: Record<string, string[]> = {};
  for (const g of item.modifierGroups) {
    const pre = g.modifiers.filter((m) => m.preSelected && m.inStock).map((m) => m.key);
    modifiers[g.id] = g.singleSelect ? pre.slice(0, 1) : pre;
  }
  return { variantId: defaultVariantId(item), modifiers, specialRequest: "" };
}

/** A new selection with `key` toggled in `groupId` — single-select replaces, multi-select toggles. Pure. */
export function toggleModifier(item: Pick<MenuItem, "modifierGroups">, selection: OrderSelection, groupId: string, key: string): OrderSelection {
  const group = item.modifierGroups.find((g) => g.id === groupId);
  const current = selection.modifiers[groupId] ?? [];
  const next = group?.singleSelect ? [key] : current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
  return { ...selection, modifiers: { ...selection.modifiers, [groupId]: next } };
}

/** Wix's checks per group: required → at least one; count >= min; count <= max when a max is set. */
export function validateSelection(item: Pick<MenuItem, "modifierGroups">, selection: OrderSelection): SelectionValidation {
  const errors: Record<string, string> = {};
  for (const g of item.modifierGroups) {
    const count = (selection.modifiers[g.id] ?? []).length;
    if (g.required && count === 0) errors[g.id] = g.minSelections > 1 ? `Choose at least ${g.minSelections}` : "Choose one";
    else if (count < g.minSelections) errors[g.id] = `Choose at least ${g.minSelections}`;
    else if (g.maxSelections && count > g.maxSelections) errors[g.id] = `Choose up to ${g.maxSelections}`;
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

/** The modifiers a selection names, resolved by KEY within their group (duplicate ids stay distinct). */
export function selectedModifiers(item: Pick<MenuItem, "modifierGroups">, selection: OrderSelection): { group: MenuModifierGroup; modifiers: MenuModifier[] }[] {
  return item.modifierGroups
    .map((group) => {
      const keys = selection.modifiers[group.id] ?? [];
      return { group, modifiers: keys.map((k) => group.modifiers.find((m) => m.key === k)).filter((m): m is MenuModifier => !!m) };
    })
    .filter((g) => g.modifiers.length > 0);
}

/** (base + variant + modifier charges) × quantity, formatted in the menu's money. */
export function itemPrice(item: Pick<MenuItem, "priceAmount" | "variants" | "modifierGroups">, selection: OrderSelection, quantity: number, money: SiteMoney): SelectionPrice {
  const base = Number(item.priceAmount ?? 0) || 0;
  const variant = Number(item.variants.find((v) => v.variantId === selection.variantId)?.priceAmount ?? 0) || 0;
  const modifiers = selectedModifiers(item, selection).reduce((sum, g) => sum + g.modifiers.reduce((s, m) => s + (Number(m.additionalChargeAmount) || 0), 0), 0);
  const amount = (base + variant + modifiers) * Math.max(quantity, 0);
  return { amount, formatted: formatPrice(amount, money) };
}

/** True when the dish needs a sheet before adding (a variant, a modifier group, or a note to collect). */
export const needsSelection = (item: Pick<MenuItem, "variants" | "modifierGroups" | "acceptsSpecialRequests">): boolean =>
  item.variants.length > 0 || item.modifierGroups.length > 0 || item.acceptsSpecialRequests;

// ---- DTO mapping -----------------------------------------------------------------------------------------

export interface MenuLookups {
  variantById: Map<string, Raw>;
  groupById: Map<string, Raw>;
  modifierById: Map<string, Raw>;
  labelById: Map<string, Raw>;
}

export function toModifierGroup(g: Raw, lookups: MenuLookups, money: SiteMoney): MenuModifierGroup {
  const rule = {
    required: g.rule?.required === true,
    minSelections: g.rule?.minSelections ?? 0,
    maxSelections: g.rule?.maxSelections ?? null,
  };
  return {
    id: rawId(g),
    name: g.name ?? "",
    ...rule,
    rule: ruleType(rule),
    singleSelect: isSingleSelectRule(rule),
    // The group-level ref carries preSelected + the up-charge; the modifier entity carries name + inStock.
    modifiers: ((g.modifiers ?? []) as Raw[]).map((m, index): MenuModifier => {
      const id = rawId(m);
      const entity = lookups.modifierById.get(id);
      const charge = m.additionalChargeInfo?.additionalCharge ?? "0";
      return {
        id,
        key: `${id}~${index}`,
        name: entity?.name ?? "",
        preSelected: m.preSelected === true,
        additionalCharge: Number(charge) > 0 ? formatPrice(charge, money, m.additionalChargeInfo?.formattedAdditionalCharge) : "",
        additionalChargeAmount: String(charge),
        inStock: entity?.inStock !== false,
      };
    }),
  };
}

export function toItem(raw: Raw, lookups: MenuLookups, imgSrc: ImgSrc, money: SiteMoney): MenuItem {
  const variants: MenuItemVariant[] = ((raw.priceVariants?.variants ?? []) as Raw[])
    .map((v): MenuItemVariant => ({
      variantId: v.variantId ?? "",
      name: lookups.variantById.get(v.variantId)?.name ?? "",
      price: formatPrice(v.priceInfo?.price, money, v.priceInfo?.formattedPrice),
      priceAmount: v.priceInfo?.price ?? "0",
    }))
    .filter((v) => v.variantId);
  const modifierGroups: MenuModifierGroup[] = ((raw.modifierGroups ?? []) as Raw[])
    .map((ref) => lookups.groupById.get(rawId(ref)))
    .filter((g): g is Raw => !!g)
    .map((g) => toModifierGroup(g, lookups, money));
  const labels: MenuItemLabel[] = ((raw.labels ?? []) as (Raw | string)[])
    .map((ref) => lookups.labelById.get(rawId(ref)))
    .filter((l): l is Raw => !!l)
    .map((l): MenuItemLabel => ({ id: rawId(l), name: l.name ?? "", iconUrl: imgSrc(l.icon, 48, 48) }));
  const priceAmount: string | null = raw.priceInfo?.price ?? null;
  const price = priceAmount === null ? null : formatPrice(priceAmount, money, raw.priceInfo?.formattedPrice);
  const marketPrice = priceAmount === null && variants.length === 0;
  const inStock = raw.orderSettings?.inStock !== false;
  const soldOut = !inStock || requiredGroupOutOfStock(modifierGroups);
  const imageUrl = imgSrc(raw.image, 800, 800);
  return {
    id: rawId(raw),
    name: raw.name ?? "",
    description: raw.description ?? "",
    price,
    priceAmount,
    marketPrice,
    variants,
    imageUrl,
    gallery: [imageUrl, ...((raw.additionalImages ?? []) as any[]).map((m) => imgSrc(m, 800, 800))].filter(Boolean),
    labels,
    modifierGroups,
    inStock,
    soldOut,
    orderable: !marketPrice && !soldOut,
    acceptsSpecialRequests: raw.orderSettings?.acceptSpecialRequests === true,
    featured: raw.featured === true,
  };
}

export function toSection(raw: Raw, itemById: Map<string, MenuItem>, imgSrc: ImgSrc): MenuSection {
  return {
    id: rawId(raw),
    name: raw.name ?? "",
    description: raw.description ?? "",
    imageUrl: imgSrc(raw.image, 800, 800),
    items: ((raw.itemIds ?? []) as string[]).map((iid) => itemById.get(iid)).filter((i): i is MenuItem => !!i),
  };
}

export function toMenu(raw: Raw, sectionById: Map<string, Raw>, itemById: Map<string, MenuItem>, imgSrc: ImgSrc, money: SiteMoney): MenuData {
  return {
    id: rawId(raw),
    name: raw.name ?? "",
    description: raw.description ?? "",
    slug: raw.urlQueryParam ?? "",
    sections: ((raw.sectionIds ?? []) as string[])
      .map((sid) => sectionById.get(sid))
      .filter((s): s is Raw => !!s)
      .map((s) => toSection(s, itemById, imgSrc)),
    money,
  };
}

/** The seven list responses' entity arrays, as either transport returns them, plus the site money. */
export interface MenuTreeParts {
  menus: Raw[];
  sections: Raw[];
  items: Raw[];
  variants: Raw[];
  groups: Raw[];
  modifiers: Raw[];
  labels: Raw[];
  money: SiteMoney;
}

/** The display-ordered tree: visible menus → their sections → their items, each item enriched. [] when no menus. */
export function assembleMenus(parts: MenuTreeParts, imgSrc: ImgSrc): MenuData[] {
  if (!parts.menus.length) return [];
  const lookups: MenuLookups = {
    variantById: byId(parts.variants),
    groupById: byId(parts.groups),
    modifierById: byId(parts.modifiers),
    labelById: byId(parts.labels),
  };
  const sectionById = byId(parts.sections);
  const itemById = new Map<string, MenuItem>(parts.items.map((i) => [rawId(i), toItem(i, lookups, imgSrc, parts.money)]));
  return parts.menus.map((m) => toMenu(m, sectionById, itemById, imgSrc, parts.money));
}
