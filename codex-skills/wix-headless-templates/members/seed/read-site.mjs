// Whether the site has a members area, and how many members.
//   node <SKILL_ROOT>/templates/members/seed/read-site.mjs [--site <siteId>]
import { runReader } from "../../shared/seed/read-site.mjs";

const MEMBERS_AREA_APP_ID = "14cc59bc-f0b7-15b8-e1c7-89ce41d0e0c9";
const D = "https://dev.wix.com/docs/api-reference/crm/members-contacts/members/members";

await runReader({
  vertical: "members",
  appId: MEMBERS_AREA_APP_ID,
  async read(api) {
    const r = await api.call({ method: "GET", path: "/members/v1/members?fieldsets=PUBLIC&paging.limit=1", docs: `${D}/list-members` });
    return { memberCount: r.metadata?.total ?? r.pagingMetadata?.total ?? null };
  },
});
