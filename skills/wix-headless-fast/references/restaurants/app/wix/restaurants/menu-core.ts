// Menu rules and DTO mapping — transport-agnostic, imported by BOTH transports: ./menu.ts (the
// SDK, managed Astro and React) and the REST twin in references/restaurants/rest/menu.ts (fetch,
// a static site or a port to another language). The hierarchy is Menu → Sections → Items wired by
// ID ARRAYS: display structure and order live in menu.sectionIds / section.itemIds, never in a
// list response's order — the tree is stitched here in id-array order and dangling ids dropped.
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
} from "./types";

/** A raw Menus V1 entity as either transport returns it. */
export type Raw = Record<string, any>;
/** Media value + size → https URL. Injected: the SDK transport scales through @wix/sdk, REST through the URL form. */
export type ImgSrc = (value: any, width: number, height: number) => string;

export const rawId = (raw: Raw | undefined | null): string => raw?._id ?? raw?.id ?? "";

/** Index raw entities by id (either spelling). */
export const byId = (arr: Raw[]): Map<string, Raw> => new Map(arr.map((e) => [rawId(e), e]));

const unique = (ids: string[]): string[] => [...new Set(ids.filter(Boolean))];

// Menu prices are decimal strings in the site currency with NO symbol; the response may carry a
// platform-formatted twin (formattedPrice) — prefer it, never invent a symbol.
export function displayPrice(priceInfo: Raw | undefined): string | null {
  if (!priceInfo) return null;
  return priceInfo.formattedPrice ?? priceInfo.price ?? null;
}

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

export interface MenuLookups {
  variantById: Map<string, Raw>;
  groupById: Map<string, Raw>;
  modifierById: Map<string, Raw>;
  labelById: Map<string, Raw>;
}

export function toItem(raw: Raw, lookups: MenuLookups, imgSrc: ImgSrc): MenuItem {
  const variants: MenuItemVariant[] = ((raw.priceVariants?.variants ?? []) as Raw[])
    .map((v): MenuItemVariant => ({
      variantId: v.variantId ?? "",
      name: lookups.variantById.get(v.variantId)?.name ?? "",
      price: displayPrice(v.priceInfo) ?? v.price ?? "",
    }))
    .filter((v) => v.variantId);
  const modifierGroups: MenuModifierGroup[] = ((raw.modifierGroups ?? []) as Raw[])
    .map((ref) => lookups.groupById.get(rawId(ref)))
    .filter((g): g is Raw => !!g)
    .map((g): MenuModifierGroup => ({
      id: rawId(g),
      name: g.name ?? "",
      required: g.rule?.required === true,
      minSelections: g.rule?.minSelections ?? 0,
      maxSelections: g.rule?.maxSelections ?? null,
      modifiers: ((g.modifiers ?? []) as Raw[]).map((m): MenuModifier => ({
        id: rawId(m),
        name: lookups.modifierById.get(rawId(m))?.name ?? "",
        preSelected: m.preSelected === true,
        additionalCharge: m.additionalChargeInfo?.additionalCharge ?? "0",
        inStock: lookups.modifierById.get(rawId(m))?.inStock !== false,
      })),
    }));
  const labels: MenuItemLabel[] = ((raw.labels ?? []) as Raw[])
    .map((ref) => lookups.labelById.get(rawId(ref)))
    .filter((l): l is Raw => !!l)
    .map((l): MenuItemLabel => ({ id: rawId(l), name: l.name ?? "", iconUrl: imgSrc(l.icon, 48, 48) }));
  const price = displayPrice(raw.priceInfo);
  return {
    id: rawId(raw),
    name: raw.name ?? "",
    description: raw.description ?? "",
    price,
    marketPrice: price === null && variants.length === 0,
    variants,
    imageUrl: imgSrc(raw.image, 800, 800),
    labels,
    modifierGroups,
    inStock: raw.orderSettings?.inStock !== false,
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

export function toMenu(raw: Raw, sectionById: Map<string, Raw>, itemById: Map<string, MenuItem>, imgSrc: ImgSrc): MenuData {
  return {
    id: rawId(raw),
    name: raw.name ?? "",
    description: raw.description ?? "",
    slug: raw.urlQueryParam ?? "",
    sections: ((raw.sectionIds ?? []) as string[])
      .map((sid) => sectionById.get(sid))
      .filter((s): s is Raw => !!s)
      .map((s) => toSection(s, itemById, imgSrc)),
  };
}

/** The seven list responses' entity arrays, as either transport returns them. */
export interface MenuTreeParts {
  menus: Raw[];
  sections: Raw[];
  items: Raw[];
  variants: Raw[];
  groups: Raw[];
  modifiers: Raw[];
  labels: Raw[];
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
  const itemById = new Map<string, MenuItem>(parts.items.map((i) => [rawId(i), toItem(i, lookups, imgSrc)]));
  return parts.menus.map((m) => toMenu(m, sectionById, itemById, imgSrc));
}
