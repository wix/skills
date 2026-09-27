// Menu reads over REST (Wix Restaurants Menus V1) — the twin of app/wix/restaurants/menu.ts. Same
// export, same MenuData tree; the rules and the id-array stitching come from menu-core (the SAME
// file the SDK transport uses, deployed flat next to this one by deploy.mjs --stack static), so
// this file is only the transport: one GET per list, literal paths and query params. Every call
// here is safe from a browser with a visitor token. Porting: keep the paths, keep the params, port
// the core once. Entities carry `id` here (the SDK spells it `_id`); the core accepts both.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/menus/list-menus.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/items/list-items.md
import { wixRequest } from "./client.js";
import { imgSrc } from "./media.js";
import { anyLabels, assembleMenus, collectGroupIds, collectModifierIds, collectVariantIds, type Raw } from "./menu-core.js";
import type { MenuData } from "./types.js";

const VISIBLE = { onlyVisible: "true" };
const get = (path: string, query?: Record<string, string | readonly string[]>) => wixRequest<Raw>(path, { method: "GET", query });

/**
 * The site's full menu tree, assembled and display-ordered — the one entry point for every menu
 * surface; [] when no menus exist. Three list reads, then the referenced variants, modifier groups,
 * and labels, then the groups' modifiers (an array query param repeats the key: ?variantIds=a&variantIds=b).
 * GET /restaurants/menus-menu/v1/menus?onlyVisible=true
 * GET /restaurants/menus-section/v1/sections?onlyVisible=true
 * GET /restaurants/menus-item/v1/items?onlyVisible=true
 * GET /restaurants/item-variants/v1/variants?variantIds=…
 * GET /restaurants/item-modifier-group/v1/modifier-groups?modifierGroupIds=…
 * GET /restaurants/item-modifiers/v1/modifiers?modifierIds=…
 * GET /restaurants/item-labels/v1/labels
 */
export async function fetchMenus(): Promise<MenuData[]> {
  const [menusRes, sectionsRes, itemsRes] = await Promise.all([
    get("/restaurants/menus-menu/v1/menus", VISIBLE),
    get("/restaurants/menus-section/v1/sections", VISIBLE),
    get("/restaurants/menus-item/v1/items", VISIBLE),
  ]);
  const menus: Raw[] = menusRes?.menus ?? [];
  if (!menus.length) return [];
  const items: Raw[] = itemsRes?.items ?? [];
  const variantIds = collectVariantIds(items);
  const groupIds = collectGroupIds(items);
  const [variantsRes, groupsRes, labelsRes] = await Promise.all([
    variantIds.length ? get("/restaurants/item-variants/v1/variants", { variantIds }) : Promise.resolve({ variants: [] } as Raw),
    groupIds.length ? get("/restaurants/item-modifier-group/v1/modifier-groups", { modifierGroupIds: groupIds }) : Promise.resolve({ modifierGroups: [] } as Raw),
    anyLabels(items) ? get("/restaurants/item-labels/v1/labels") : Promise.resolve({ labels: [] } as Raw),
  ]);
  const groups: Raw[] = groupsRes?.modifierGroups ?? [];
  const modifierIds = collectModifierIds(groups);
  const modifiersRes: Raw = modifierIds.length ? await get("/restaurants/item-modifiers/v1/modifiers", { modifierIds }) : { modifiers: [] };
  return assembleMenus(
    {
      menus,
      sections: sectionsRes?.sections ?? [],
      items,
      variants: variantsRes?.variants ?? [],
      groups,
      modifiers: modifiersRes?.modifiers ?? [],
      labels: labelsRes?.labels ?? [],
    },
    imgSrc,
  );
}
