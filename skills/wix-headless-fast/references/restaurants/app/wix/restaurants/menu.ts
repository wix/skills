// Menu reads (Wix Restaurants Menus V1) — the only file that touches raw menu entities.
// Everything it returns is a plain DTO from ./types. Copy as-is; extend by adding functions,
// not by editing these.
//
// The hierarchy is Menu → Sections → Items wired by ID ARRAYS: display structure and order
// live in menu.sectionIds / section.itemIds, NOT in the list* response order — fetchMenus
// stitches in id-array order and drops dangling ids. Entity ids are `_id` (never `id`).
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/menus/list-menus.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/sections/list-sections.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/items/list-items.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/item-variants/list-variants.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/item-modifier-groups/list-modifier-groups.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/item-modifiers/list-modifiers.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/item-labels/list-labels.md
import {
  menus as menusModule,
  sections as sectionsModule,
  items as itemsModule,
  itemVariants,
  itemModifierGroups,
  itemModifiers,
  itemLabels,
} from "@wix/restaurants";
import { wixModule } from "../sdk";
import { imgSrc } from "../media";
import type {
  MenuData,
  MenuItem,
  MenuItemLabel,
  MenuItemVariant,
  MenuModifier,
  MenuModifierGroup,
  MenuSection,
} from "./types";

const menusApi = wixModule(menusModule);
const sectionsApi = wixModule(sectionsModule);
const itemsApi = wixModule(itemsModule);
const variantsApi = wixModule(itemVariants);
const groupsApi = wixModule(itemModifierGroups);
const modifiersApi = wixModule(itemModifiers);
const labelsApi = wixModule(itemLabels);

type Raw = Record<string, any>;

// Menu prices are decimal strings in the site currency with NO symbol; the response may
// carry a platform-formatted twin (formattedPrice) — prefer it, never invent a symbol.
function displayPrice(priceInfo: Raw | undefined): string | null {
  if (!priceInfo) return null;
  return priceInfo.formattedPrice ?? priceInfo.price ?? null;
}

function toItem(
  raw: Raw,
  lookups: { variantById: Map<string, Raw>; groupById: Map<string, Raw>; modifierById: Map<string, Raw>; labelById: Map<string, Raw> },
): MenuItem {
  const variants: MenuItemVariant[] = (raw.priceVariants?.variants ?? [])
    .map((v: Raw): MenuItemVariant => ({
      variantId: v.variantId ?? "",
      name: lookups.variantById.get(v.variantId)?.name ?? "",
      price: displayPrice(v.priceInfo) ?? v.price ?? "",
    }))
    .filter((v: MenuItemVariant) => v.variantId);
  const modifierGroups: MenuModifierGroup[] = (raw.modifierGroups ?? [])
    .map((ref: Raw) => lookups.groupById.get(ref._id))
    .filter(Boolean)
    .map((g: Raw): MenuModifierGroup => ({
      id: g._id ?? "",
      name: g.name ?? "",
      required: g.rule?.required === true,
      minSelections: g.rule?.minSelections ?? 0,
      maxSelections: g.rule?.maxSelections ?? null,
      modifiers: (g.modifiers ?? []).map((m: Raw): MenuModifier => ({
        id: m._id ?? "",
        name: lookups.modifierById.get(m._id)?.name ?? "",
        preSelected: m.preSelected === true,
        additionalCharge: m.additionalChargeInfo?.additionalCharge ?? "0",
        inStock: lookups.modifierById.get(m._id)?.inStock !== false,
      })),
    }));
  const labels: MenuItemLabel[] = (raw.labels ?? [])
    .map((ref: Raw) => lookups.labelById.get(ref._id))
    .filter(Boolean)
    .map((l: Raw): MenuItemLabel => ({ id: l._id ?? "", name: l.name ?? "", iconUrl: imgSrc(l.icon, 48, 48) }));
  const price = displayPrice(raw.priceInfo);
  return {
    id: raw._id ?? "",
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

/**
 * The site's full menu tree, assembled and display-ordered: visible menus → their sections →
 * their items, each item enriched with resolved price variants, modifier groups, and labels.
 * The one entry point for every menu surface. [] when no menus exist (honest empty state).
 * Caps at the APIs' 500-per-list limit — plenty for a restaurant.
 */
export async function fetchMenus(): Promise<MenuData[]> {
  const [menusRes, sectionsRes, itemsRes]: Raw[] = await Promise.all([
    menusApi.listMenus({ onlyVisible: true }),
    sectionsApi.listSections({ onlyVisible: true }),
    itemsApi.listItems({ onlyVisible: true }),
  ]);
  const menus: Raw[] = menusRes.menus ?? [];
  if (!menus.length) return [];
  const sections: Raw[] = sectionsRes.sections ?? [];
  const items: Raw[] = itemsRes.items ?? [];

  const variantIds: string[] = [
    ...new Set(items.flatMap((i: Raw) => (i.priceVariants?.variants ?? []).map((v: Raw) => v.variantId)).filter(Boolean)),
  ] as string[];
  const groupIds: string[] = [
    ...new Set(items.flatMap((i: Raw) => (i.modifierGroups ?? []).map((g: Raw) => g._id)).filter(Boolean)),
  ] as string[];
  const hasLabels = items.some((i: Raw) => (i.labels ?? []).length > 0);

  const [variantsRes, groupsRes, labelsRes]: Raw[] = await Promise.all([
    variantIds.length ? variantsApi.listVariants({ variantIds }) : Promise.resolve({ variants: [] }),
    groupIds.length ? groupsApi.listModifierGroups({ modifierGroupIds: groupIds }) : Promise.resolve({ modifierGroups: [] }),
    hasLabels ? labelsApi.listLabels() : Promise.resolve({ labels: [] }),
  ]);
  const groups: Raw[] = groupsRes.modifierGroups ?? [];
  const modifierIds: string[] = [
    ...new Set(groups.flatMap((g: Raw) => (g.modifiers ?? []).map((m: Raw) => m._id)).filter(Boolean)),
  ] as string[];
  const modifiersRes: Raw = modifierIds.length
    ? await modifiersApi.listModifiers({ modifierIds })
    : { modifiers: [] };

  const byId = (arr: Raw[]) => new Map<string, Raw>(arr.map((e: Raw) => [e._id, e]));
  const lookups = {
    variantById: byId(variantsRes.variants ?? []),
    groupById: byId(groups),
    modifierById: byId(modifiersRes.modifiers ?? []),
    labelById: byId(labelsRes.labels ?? []),
  };
  const sectionById = byId(sections);
  const itemById = new Map<string, MenuItem>(items.map((i: Raw) => [i._id, toItem(i, lookups)]));

  return menus.map((m: Raw): MenuData => ({
    id: m._id ?? "",
    name: m.name ?? "",
    description: m.description ?? "",
    slug: m.urlQueryParam ?? "",
    sections: (m.sectionIds ?? [])
      .map((sid: string) => sectionById.get(sid))
      .filter(Boolean)
      .map((s: Raw): MenuSection => ({
        id: s._id ?? "",
        name: s.name ?? "",
        description: s.description ?? "",
        imageUrl: imgSrc(s.image, 800, 800),
        items: (s.itemIds ?? []).map((iid: string) => itemById.get(iid)).filter(Boolean) as MenuItem[],
      })),
  }));
}
