// Menu reads over REST (Wix Restaurants Menus V1) — the twin of app/wix/restaurants/menu.ts. Same
// exports, same MenuData tree; the rules and the id-array stitching come from menu-core (the SAME
// file the SDK transport uses, deployed flat next to this one by deploy.mjs --stack static), so
// this file is only the transport: one GET per list page, literal paths and query params. Every
// call here is safe from a browser with a visitor token. Porting: keep the paths, keep the params,
// port the core once. Entities carry `id` here (the SDK spells it `_id`); the core accepts both.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/menus/list-menus.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/items/list-items.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/ecommerce-settings/get-ecommerce-settings.md
import { wixRequest } from "./client.js";
import { imgSrc } from "./media.js";
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
} from "./menu-core.js";
import type { MenuData, SiteMoney } from "./types.js";

const get = (path: string, query?: Record<string, string | readonly string[]>) => wixRequest<Raw>(path, { method: "GET", query });

// The site's currency + locale are site config — read once per page, reused by every price.
let moneyPromise: Promise<SiteMoney> | null = null;

/**
 * The site's currency and locale from the eCommerce settings' BUSINESS_INFO (the read Wix's own
 * menus code makes before formatting a price). { currency: "" } when the read fails: prices then
 * format to "" rather than to a guessed symbol.
 * GET /_api/ecommerce-settings/v1/ecommerce-settings?fields=BUSINESS_INFO   (the path the SDK resolves on www.wixapis.com)
 */
export function fetchSiteMoney(): Promise<SiteMoney> {
  moneyPromise ??= get("/_api/ecommerce-settings/v1/ecommerce-settings", { fields: ["BUSINESS_INFO"] })
    .then((res) => toSiteMoney(res))
    .catch(() => {
      moneyPromise = null; // transient failure — allow a retry on the next call
      return { currency: "", locale: "" };
    });
  return moneyPromise;
}

/** Every page of a cursor-paged list (?paging.cursor=…, pagingMetadata.cursors.next), the entities concatenated. */
async function allPages(path: string, query: Record<string, string>, key: string): Promise<Raw[]> {
  const out: Raw[] = [];
  let cursor: string | null = null;
  do {
    const res: Raw = await get(path, cursor ? { ...query, "paging.cursor": cursor } : query);
    out.push(...((res?.[key] ?? []) as Raw[]));
    cursor = nextCursor(res);
  } while (cursor);
  return out;
}

/** An id-array read in chunks of 100 ids per call (the key repeats: ?variantIds=a&variantIds=b), the entities concatenated. */
async function byIds(path: string, param: string, ids: string[], key: string): Promise<Raw[]> {
  const pages = await Promise.all(chunk(ids).map((part) => get(path, { [param]: part })));
  return pages.flatMap((res) => (res?.[key] ?? []) as Raw[]);
}

/**
 * The site's full menu tree, assembled and display-ordered, every price formatted in the site's
 * currency — the one entry point for every menu surface; [] when no menus exist. The three visible
 * lists are read to the last page, then the referenced variants, modifier groups (100 ids per
 * call), and labels, then the groups' modifiers.
 * GET /restaurants/menus-menu/v1/menus?onlyVisible=true[&paging.cursor=…]
 * GET /restaurants/menus-section/v1/sections?onlyVisible=true[&paging.cursor=…]
 * GET /restaurants/menus-item/v1/items?onlyVisible=true[&paging.cursor=…]
 * GET /restaurants/item-variants/v1/variants?variantIds=…
 * GET /restaurants/item-modifier-group/v1/modifier-groups?modifierGroupIds=…
 * GET /restaurants/item-modifiers/v1/modifiers?modifierIds=…
 * GET /restaurants/item-labels/v1/labels
 */
export async function fetchMenus(): Promise<MenuData[]> {
  const VISIBLE = { onlyVisible: "true" };
  const [menus, sections, items, money] = await Promise.all([
    allPages("/restaurants/menus-menu/v1/menus", VISIBLE, "menus"),
    allPages("/restaurants/menus-section/v1/sections", VISIBLE, "sections"),
    allPages("/restaurants/menus-item/v1/items", VISIBLE, "items"),
    fetchSiteMoney(),
  ]);
  if (!menus.length) return [];
  const variantIds = collectVariantIds(items);
  const groupIds = collectGroupIds(items);
  const [variants, groups, labels] = await Promise.all([
    byIds("/restaurants/item-variants/v1/variants", "variantIds", variantIds, "variants"),
    byIds("/restaurants/item-modifier-group/v1/modifier-groups", "modifierGroupIds", groupIds, "modifierGroups"),
    // List Labels has no paging: one call returns them all.
    anyLabels(items) ? get("/restaurants/item-labels/v1/labels").then((res) => (res?.labels ?? []) as Raw[]) : Promise.resolve([] as Raw[]),
  ]);
  const modifiers = await byIds("/restaurants/item-modifiers/v1/modifiers", "modifierIds", collectModifierIds(groups), "modifiers");
  return assembleMenus({ menus, sections, items, variants, groups, modifiers, labels, money }, imgSrc);
}
