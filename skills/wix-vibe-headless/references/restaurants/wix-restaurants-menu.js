import { wixApiRequest } from "./wix-client.js";

// Data model reference: see INSTRUCTIONS.md

/**
 * Menu — top of the hierarchy. One per published menu (e.g. Dinner, Drinks).
 *   id {string}, name {string}, description {string}, visible {boolean},
 *   sectionIds {string[]} — ordered Section GUIDs,
 *   urlQueryParam {string} — URL slug fragment, businessLocationId {string}
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/menus/menu-object.md
 *
 * Section — a group of items within a menu (e.g. Appetizers, Mains).
 *   id {string}, name {string}, description {string},
 *   image {object} — { id, url, width, height, altText },
 *   itemIds {string[]} — ordered Item GUIDs, visible {boolean}
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/sections/section-object.md
 *
 * Item — a single dish/drink. Has EITHER priceInfo (single price) OR priceVariants (one-of).
 *   id {string}, name {string}, description {string},
 *   image {object} — { id, url, width, height, altText },
 *   priceInfo.price {string} — decimal string e.g. "12.50" (NO currency symbol),
 *   priceVariants.variants {object[]} — [{ variantId, priceInfo: { price } }],
 *   labels {object[]} — [{ id }] resolve via listLabels,
 *   visible {boolean}, featured {boolean},
 *   orderSettings.inStock {boolean}, orderSettings.acceptSpecialRequests {boolean},
 *   modifierGroups {object[]} — [{ id }] resolve via listModifierGroups
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/items/item-object.md
 *
 * PriceVariant (from listVariants): { id, name } — name for the variantId in item.priceVariants.
 * ModifierGroup: { id, name, rule: { required, minSelections, maxSelections },
 *   modifiers: [{ id, preSelected, additionalChargeInfo: { additionalCharge } }] }
 * Modifier (from listModifiers): { id, name, inStock }
 * Label (from listLabels): { id, name, icon: { url } } — e.g. "Vegan", "Spicy"
 *
 * NOTE: Restaurant prices are plain decimal strings with NO currency symbol.
 * getFullMenu() assembles the full tree and is the recommended entry point.
 */

/**
 * Internal: fetch a list endpoint by a set of GUIDs, chunked to avoid long query strings.
 */
async function fetchAllByIds(path, idParamName, responseKey, ids, extraQuery = {}) {
  const unique = [...new Set((ids ?? []).filter(Boolean))];
  if (!unique.length) return [];
  const out = [];
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const res = await wixApiRequest(path, {
      method: "GET",
      query: { [idParamName]: chunk, ...extraQuery },
    });
    out.push(...(res?.[responseKey] ?? []));
  }
  return out;
}

/**
 * List menus (one page). Pass `onlyVisible: true` for visitor-facing menus.
 * GET https://www.wixapis.com/restaurants/menus/v1/menus
 * @param {{ onlyVisible?: boolean, limit?: number, cursor?: string }} [options]
 * @returns {Promise<{ menus: object[], nextCursor: string|null }>}
 */
export async function listMenus({ onlyVisible = true, limit = 500, cursor } = {}) {
  const res = await wixApiRequest("/restaurants/menus/v1/menus", {
    method: "GET",
    query: {
      onlyVisible: onlyVisible ? "true" : undefined,
      "paging.limit": String(limit),
      "paging.cursor": cursor,
    },
  });
  return { menus: res?.menus ?? [], nextCursor: res?.pagingMetadata?.cursors?.next ?? null };
}

/**
 * List sections by their GUIDs.
 * @param {string[]} sectionIds
 * @param {{ onlyVisible?: boolean }} [options]
 * @returns {Promise<object[]>}
 */
export async function listSections(sectionIds, { onlyVisible = true } = {}) {
  return fetchAllByIds("/restaurants/menus/v1/sections", "sectionIds", "sections", sectionIds, {
    onlyVisible: onlyVisible ? "true" : undefined,
  });
}

/**
 * List items by their GUIDs.
 * @param {string[]} itemIds
 * @param {{ onlyVisible?: boolean }} [options]
 * @returns {Promise<object[]>}
 */
export async function listItems(itemIds, { onlyVisible = true } = {}) {
  return fetchAllByIds("/restaurants/menus/v1/items", "itemIds", "items", itemIds, {
    onlyVisible: onlyVisible ? "true" : undefined,
  });
}

/**
 * List price variants by their GUIDs (resolves variantId → name).
 * @param {string[]} variantIds
 * @returns {Promise<object[]>}
 */
export async function listVariants(variantIds) {
  return fetchAllByIds("/restaurants/menus/v1/variants", "variantIds", "variants", variantIds);
}

/**
 * List modifier groups by their GUIDs.
 * @param {string[]} modifierGroupIds
 * @returns {Promise<object[]>}
 */
export async function listModifierGroups(modifierGroupIds) {
  return fetchAllByIds(
    "/restaurants/menus/v1/modifier-groups",
    "modifierGroupIds",
    "modifierGroups",
    modifierGroupIds,
  );
}

/**
 * List modifiers by their GUIDs (resolves modifierId → name + inStock).
 * @param {string[]} modifierIds
 * @returns {Promise<object[]>}
 */
export async function listModifiers(modifierIds) {
  return fetchAllByIds("/restaurants/item-modifiers/v1/modifiers", "modifierIds", "modifiers", modifierIds);
}

/**
 * List every item label on the site.
 * @returns {Promise<object[]>}
 */
export async function listLabels() {
  const res = await wixApiRequest("/restaurants/menus/v1/labels", { method: "GET" });
  return res?.labels ?? [];
}

/**
 * Retrieve the complete assembled menu tree in one call. Walks menus → sections → items,
 * then enriches each item with resolved price variants, modifier groups + modifiers, and labels.
 * This is the recommended entry point for the menu screen.
 *
 * Returns:
 *   { menus: [ { ...menu, sections: [ { ...section, items: [ assembledItem ] } ] } ] }
 * where assembledItem adds:
 *   price          {string|null}  Single price (null when variant-priced)
 *   variants       {object[]}     [{ variantId, name, price }]
 *   modifierGroups {object[]}     [{ id, name, rule, modifiers: [{ id, name, preSelected, additionalCharge, inStock }] }]
 *   labels         {object[]}     [{ id, name, icon }]
 *
 * https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/retrieve-a-complete-menu-structure.md
 * @param {{ onlyVisible?: boolean }} [options]
 * @returns {Promise<{ menus: object[] }>}
 */
export async function getFullMenu({ onlyVisible = true } = {}) {
  const { menus } = await listMenus({ onlyVisible });
  if (!menus.length) return { menus: [] };

  const sectionIds = menus.flatMap((m) => m.sectionIds ?? []);
  const sections = await listSections(sectionIds, { onlyVisible });

  const itemIds = sections.flatMap((s) => s.itemIds ?? []);
  const items = await listItems(itemIds, { onlyVisible });

  const variantIds = items.flatMap((i) => (i.priceVariants?.variants ?? []).map((v) => v.variantId));
  const modifierGroupIds = items.flatMap((i) => (i.modifierGroups ?? []).map((g) => g.id));

  const [variants, modifierGroups, labels] = await Promise.all([
    listVariants(variantIds),
    listModifierGroups(modifierGroupIds),
    listLabels(),
  ]);

  const modifierIds = modifierGroups.flatMap((g) => (g.modifiers ?? []).map((m) => m.id));
  const modifiers = await listModifiers(modifierIds);

  const variantMap = new Map(variants.map((v) => [v.id, v]));
  const groupMap = new Map(modifierGroups.map((g) => [g.id, g]));
  const modifierMap = new Map(modifiers.map((m) => [m.id, m]));
  const labelMap = new Map(labels.map((l) => [l.id, l]));

  const assembleItem = (item) => ({
    ...item,
    price: item.priceInfo?.price ?? null,
    variants: (item.priceVariants?.variants ?? []).map((v) => ({
      variantId: v.variantId,
      name: variantMap.get(v.variantId)?.name ?? null,
      price: v.priceInfo?.price ?? null,
    })),
    modifierGroups: (item.modifierGroups ?? [])
      .map((ref) => groupMap.get(ref.id))
      .filter(Boolean)
      .map((group) => ({
        id: group.id,
        name: group.name,
        rule: group.rule ?? null,
        modifiers: (group.modifiers ?? []).map((m) => ({
          id: m.id,
          name: modifierMap.get(m.id)?.name ?? null,
          preSelected: m.preSelected ?? false,
          additionalCharge: m.additionalChargeInfo?.additionalCharge ?? "0",
          inStock: modifierMap.get(m.id)?.inStock ?? true,
        })),
      })),
    labels: (item.labels ?? []).map((ref) => labelMap.get(ref.id)).filter(Boolean),
  });

  const itemMap = new Map(items.map((i) => [i.id, assembleItem(i)]));
  const sectionMap = new Map(
    sections.map((s) => [
      s.id,
      { ...s, items: (s.itemIds ?? []).map((id) => itemMap.get(id)).filter(Boolean) },
    ]),
  );

  return {
    menus: menus.map((m) => ({
      ...m,
      sections: (m.sectionIds ?? []).map((id) => sectionMap.get(id)).filter(Boolean),
    })),
  };
}
