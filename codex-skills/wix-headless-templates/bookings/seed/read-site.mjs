// What the booking business holds: services, staff, categories.
//   node <SKILL_ROOT>/templates/bookings/seed/read-site.mjs [--site <siteId>] [--limit <n>]
import { runReader } from "../../shared/seed/read-site.mjs";

const BOOKINGS_APP_ID = "13d21c63-b5ec-5912-8397-c3a5ddb27a97";
const D = "https://dev.wix.com/docs/api-reference/business-solutions/bookings";

await runReader({
  vertical: "bookings",
  appId: BOOKINGS_APP_ID,
  async read(api, { limit }) {
    const services = await api.call({ path: "/_api/bookings/v2/services/query", body: { query: { paging: { limit }, filter: { hidden: { $eq: false } } } }, docs: `${D}/services/services-v2/query-services` });
    const staff = await api.tryCall({ path: "/bookings/v1/staff-members/query", body: { query: {}, fields: ["RESOURCE_DETAILS"] }, docs: `${D}/staff-members/staff-members/query-staff-members` });
    const cats = await api.tryCall({ path: "/bookings/v2/categories/query", body: { query: {} }, docs: `${D}/services/categories-v2/query-categories` });
    return {
      serviceCount: services.pagingMetadata?.total ?? (services.services ?? []).length,
      services: (services.services ?? []).map((s) => ({
        name: s.name, slug: s.mainSlug?.name ?? null, type: s.type ?? null,
        category: s.category?.name ?? null,
        price: s.payment?.fixed?.price ? `${s.payment.fixed.price.value} ${s.payment.fixed.price.currency}` : s.payment?.varied?.defaultPrice ? `from ${s.payment.varied.defaultPrice.value} ${s.payment.varied.defaultPrice.currency}` : (s.payment?.rateType ?? null),
        durationMinutes: s.schedule?.availabilityConstraints?.sessionDurations?.[0] ?? null,
        online: s.payment?.options?.online ?? false, inPerson: s.payment?.options?.inPerson ?? false, media: s.media?.mainMedia ? 1 : 0,
      })),
      staff: (staff?.staffMembers ?? []).map((m) => m.name),
      categories: (cats?.categories ?? []).map((c) => ({ id: c.id, name: c.name })),
    };
  },
});
