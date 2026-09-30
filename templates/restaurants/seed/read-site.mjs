// What the restaurant holds: menus, sections, items, locations.
//   node <SKILL_ROOT>/templates/restaurants/seed/read-site.mjs [--site <siteId>] [--limit <n>]
import { runReader } from "../../shared/seed/read-site.mjs";

const MENUS_APP_ID = "b278a256-2757-4f19-9313-c05c783bec92";
const D = "https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus";
const DL = "https://dev.wix.com/docs/api-reference/business-management/locations";

await runReader({
  vertical: "restaurants",
  appId: MENUS_APP_ID,
  async read(api, { limit }) {
    const menus = await api.call({ method: "GET", path: "/restaurants/menus/v1/menus", docs: `${D}/menus/list-menus` });
    const sections = await api.tryCall({ method: "GET", path: "/restaurants/menus/v1/sections", docs: `${D}/sections/list-sections` });
    const items = await api.tryCall({ method: "GET", path: "/restaurants/menus/v1/items", docs: `${D}/items/items/list-items` });
    const locs = await api.tryCall({ method: "GET", path: "/locations/v1/locations", docs: `${DL}/list-locations` });
    const secs = sections?.sections ?? []; const its = items?.items ?? [];
    return {
      menus: (menus.menus ?? []).map((m) => ({ name: m.name, visible: m.visible !== false, sections: (m.sectionIds ?? []).map((id) => secs.find((s) => s.id === id)?.name ?? id) })),
      sectionCount: secs.length, itemCount: its.length,
      items: its.slice(0, limit).map((i) => ({ name: i.name, price: i.priceInfo?.price ?? i.priceVariants ? "variants" : null, image: !!i.image, labels: (i.labels ?? []).length })),
      locations: (locs?.locations ?? []).map((l) => ({ name: l.name, default: !!l.default, address: l.address?.formattedAddress ?? null })),
    };
  },
});
