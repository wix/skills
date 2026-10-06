// What the CMS holds: collections, their fields, item counts, a few sample items each.
//   node <SKILL_ROOT>/templates/cms/seed/read-site.mjs [--site <siteId>] [--limit <n>]
import { runReader } from "../../shared/seed/read-site.mjs";

const D = "https://dev.wix.com/docs/api-reference/business-solutions/cms";

await runReader({
  vertical: "cms",
  async read(api, { limit }) {
    const r = await api.call({ method: "GET", path: "/wix-data/v2/collections", docs: `${D}/collection-management/data-collections/list-data-collections` });
    const all = r.collections ?? r.dataCollections ?? [];
    const own = all.filter((c) => c.collectionType !== "WIX_APP");
    const collections = [];
    for (const c of own.slice(0, limit)) {
      const items = await api.tryCall({ path: "/wix-data/v2/items/query", body: { dataCollectionId: c.id, query: { paging: { limit: 3 } }, returnTotalCount: true }, docs: `${D}/data-items/query-data-items` });
      collections.push({ id: c.id, displayName: c.displayName, fields: (c.fields ?? []).map((f) => `${f.key}:${f.type}`), itemCount: items?.pagingMetadata?.total ?? null, sample: (items?.dataItems ?? []).map((i) => i.data?.title ?? i.data?.name ?? i.id) });
    }
    return { collectionCount: own.length, collections, appCollections: all.filter((c) => c.collectionType === "WIX_APP").map((c) => c.id) };
  },
});
