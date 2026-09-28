// Menu reads (Wix Restaurants Menus V1) over the SDK — the only file that touches raw menu
// entities on this transport. Everything it returns is a plain DTO from ./types. The rules and
// the tree assembly live in ./menu-core (shared with the REST twin in templates/restaurants/rest/);
// this file is the transport only. Copy as-is; extend by adding functions, not by editing these.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/menus/list-menus.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/sections/list-sections.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/items/list-items.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/item-variants/list-variants.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/item-modifier-groups/list-modifier-groups.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/item-modifiers/list-modifiers.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/item-labels/list-labels.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/ecommerce-settings/get-ecommerce-settings.md
import {
  menus as menusModule,
  sections as sectionsModule,
  items as itemsModule,
  itemVariants,
  itemModifierGroups,
  itemModifiers,
  itemLabels,
} from "@wix/restaurants";
import { ecommerceSettings } from "@wix/ecom";
import { wixModule } from "../sdk";
import { imgSrc } from "../media";
import {
  anyLabels,
  assembleMenus,
  chunk,
  collectGroupIds,
  collectModifierIds,
  collectVariantIds,
  nextCursor,
  toSiteMoney,
  type Raw,
} from "./menu-core";
import type { MenuData, SiteMoney } from "./types";

const menusApi = wixModule(menusModule);
const sectionsApi = wixModule(sectionsModule);
const itemsApi = wixModule(itemsModule);
const variantsApi = wixModule(itemVariants);
const groupsApi = wixModule(itemModifierGroups);
const modifiersApi = wixModule(itemModifiers);
const labelsApi = wixModule(itemLabels);
const settingsApi = wixModule(ecommerceSettings);

// The site's currency + locale are site config — read once per process, reused by every price.
let moneyPromise: Promise<SiteMoney> | null = null;

/**
 * The site's currency and locale from the eCommerce settings (BUSINESS_INFO) — the read Wix's own
 * menus code makes before formatting a price. { currency: "" } when the read fails: prices then
 * format to "" rather than to a guessed symbol.
 */
export function fetchSiteMoney(): Promise<SiteMoney> {
  moneyPromise ??= settingsApi
    .getEcommerceSettings(["BUSINESS_INFO"])
    .then((res: Raw) => toSiteMoney(res))
    .catch(() => {
      moneyPromise = null; // transient failure — allow a retry on the next call
      return { currency: "", locale: "" };
    });
  return moneyPromise;
}

/** Every page of a cursor-paged list (pagingMetadata.cursors.next), the entities concatenated. */
async function allPages(call: (cursor: string | null) => Promise<Raw>, key: string): Promise<Raw[]> {
  const out: Raw[] = [];
  let cursor: string | null = null;
  do {
    const res: Raw = await call(cursor);
    out.push(...((res?.[key] ?? []) as Raw[]));
    cursor = nextCursor(res);
  } while (cursor);
  return out;
}

/** An id-array read in chunks of 100 ids per call, the entities concatenated. */
async function byIds(ids: string[], call: (ids: string[]) => Promise<Raw>, key: string): Promise<Raw[]> {
  const pages = await Promise.all(chunk(ids).map((part) => call(part)));
  return pages.flatMap((res) => (res?.[key] ?? []) as Raw[]);
}

/**
 * The site's full menu tree, assembled and display-ordered: visible menus → their sections →
 * their items, each item enriched with resolved price variants, modifier groups, and labels, every
 * price formatted in the site's currency. The one entry point for every menu surface. [] when no
 * menus exist (honest empty state). The three visible lists are read to the last page; the
 * referenced variants, groups, and modifiers by id (100 per call).
 */
export async function fetchMenus(): Promise<MenuData[]> {
  const [menus, sections, items, money] = await Promise.all([
    allPages((cursor) => menusApi.listMenus({ onlyVisible: true, ...(cursor ? { paging: { cursor } } : {}) }), "menus"),
    allPages((cursor) => sectionsApi.listSections({ onlyVisible: true, ...(cursor ? { paging: { cursor } } : {}) }), "sections"),
    allPages((cursor) => itemsApi.listItems({ onlyVisible: true, ...(cursor ? { paging: { cursor } } : {}) }), "items"),
    fetchSiteMoney(),
  ]);
  if (!menus.length) return [];
  const variantIds = collectVariantIds(items);
  const groupIds = collectGroupIds(items);
  const [variants, groups, labels] = await Promise.all([
    byIds(variantIds, (ids) => variantsApi.listVariants({ variantIds: ids }), "variants"),
    byIds(groupIds, (ids) => groupsApi.listModifierGroups({ modifierGroupIds: ids }), "modifierGroups"),
    // List Labels has no paging: one call returns them all.
    anyLabels(items) ? labelsApi.listLabels().then((res: Raw) => (res?.labels ?? []) as Raw[]) : Promise.resolve([] as Raw[]),
  ]);
  const modifiers = await byIds(collectModifierIds(groups), (ids) => modifiersApi.listModifiers({ modifierIds: ids }), "modifiers");
  return assembleMenus({ menus, sections, items, variants, groups, modifiers, labels, money }, imgSrc);
}
