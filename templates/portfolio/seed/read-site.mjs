// What the portfolio holds: collections and projects.
//   node <SKILL_ROOT>/templates/portfolio/seed/read-site.mjs [--site <siteId>] [--limit <n>]
import { runReader } from "../../shared/seed/read-site.mjs";

const PORTFOLIO_APP_ID = "d90652a2-f5a1-4c7c-84c4-d4cdcc41f130";
const D = "https://dev.wix.com/docs/api-reference/business-solutions/portfolio";

await runReader({
  vertical: "portfolio",
  appId: PORTFOLIO_APP_ID,
  async read(api, { limit }) {
    const cols = await api.call({ method: "GET", path: "/portfolio/v1/collections", docs: `${D}/collections/list-collections` });
    const projs = await api.tryCall({ method: "GET", path: "/portfolio/v1/projects", docs: `${D}/projects/list-projects` });
    return {
      collections: (cols.collections ?? []).map((c) => ({ id: c.id, title: c.title, slug: c.slug, hidden: c.hidden ?? false, cover: !!c.coverImage })),
      projectCount: (projs?.projects ?? []).length,
      projects: (projs?.projects ?? []).slice(0, limit).map((p) => ({ title: p.title, slug: p.slug, hidden: p.hidden ?? false, collections: (p.collectionIds ?? []).length, cover: !!p.coverImage })),
    };
  },
});
