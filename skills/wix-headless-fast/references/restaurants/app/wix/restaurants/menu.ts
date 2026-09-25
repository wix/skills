// Menu reads (Wix Restaurants Menus V1) over the SDK — the only file that touches raw menu
// entities on this transport. Everything it returns is a plain DTO from ./types. The rules and
// the tree assembly live in ./menu-core (shared with the REST twin in references/restaurants/rest/);
// this file is the transport only. Copy as-is; extend by adding functions, not by editing these.
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
import { anyLabels, assembleMenus, collectGroupIds, collectModifierIds, collectVariantIds, type Raw } from "./menu-core";
import type { MenuData } from "./types";

const menusApi = wixModule(menusModule);
const sectionsApi = wixModule(sectionsModule);
const itemsApi = wixModule(itemsModule);
const variantsApi = wixModule(itemVariants);
const groupsApi = wixModule(itemModifierGroups);
const modifiersApi = wixModule(itemModifiers);
const labelsApi = wixModule(itemLabels);

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
  const items: Raw[] = itemsRes.items ?? [];
  const variantIds = collectVariantIds(items);
  const groupIds = collectGroupIds(items);
  const [variantsRes, groupsRes, labelsRes]: Raw[] = await Promise.all([
    variantIds.length ? variantsApi.listVariants({ variantIds }) : Promise.resolve({ variants: [] }),
    groupIds.length ? groupsApi.listModifierGroups({ modifierGroupIds: groupIds }) : Promise.resolve({ modifierGroups: [] }),
    anyLabels(items) ? labelsApi.listLabels() : Promise.resolve({ labels: [] }),
  ]);
  const groups: Raw[] = groupsRes.modifierGroups ?? [];
  const modifierIds = collectModifierIds(groups);
  const modifiersRes: Raw = modifierIds.length ? await modifiersApi.listModifiers({ modifierIds }) : { modifiers: [] };
  return assembleMenus(
    {
      menus,
      sections: sectionsRes.sections ?? [],
      items,
      variants: variantsRes.variants ?? [],
      groups,
      modifiers: modifiersRes.modifiers ?? [],
      labels: labelsRes.labels ?? [],
    },
    imgSrc,
  );
}
