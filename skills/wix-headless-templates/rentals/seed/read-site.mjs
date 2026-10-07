// What the rentals business holds: rental services (the Rentals app's), resource types, resources.
//   node <SKILL_ROOT>/templates/rentals/seed/read-site.mjs [--site <siteId>] [--limit <n>]
import { runReader } from "../../shared/seed/read-site.mjs";

const RENTALS_APP_ID = "ff5d6eb1-65e4-4f9a-8b14-64d34c12cc2e";
const D = "https://dev.wix.com/docs/api-reference/business-solutions/bookings";

const rangeOf = (s) => {
  const r = s.schedule?.availabilityConstraints?.durationRange;
  if (!r?.unitType) return null;
  return r.unitType === "DAY" ? `${r.dayOptions?.minDurationInDays}-${r.dayOptions?.maxDurationInDays} days` : `${(r.hourOptions?.minDurationInMinutes ?? 0) / 60}-${(r.hourOptions?.maxDurationInMinutes ?? 0) / 60} hours`;
};

await runReader({
  vertical: "rentals",
  appId: RENTALS_APP_ID,
  async read(api, { limit }) {
    const services = await api.call({ path: "/bookings/v2/services/query", body: { query: { paging: { limit }, filter: { appId: RENTALS_APP_ID, hidden: false } } }, docs: `${D}/services/services-v2/query-services` });
    const types = await api.tryCall({ path: "/bookings/v2/resources/resource-types/query", body: { query: { cursorPaging: { limit: 100 } } }, docs: `${D}/resources/resource-types-v2/query-resource-types` });
    const resources = await api.tryCall({ path: "/bookings/v2/resources/query", body: { query: { cursorPaging: { limit: 100 } } }, docs: `${D}/resources/resources-v2/query-resources` });
    return {
      rentalCount: services.pagingMetadata?.total ?? (services.services ?? []).length,
      rentals: (services.services ?? []).map((s) => ({
        name: s.name, slug: s.mainSlug?.name ?? null, range: rangeOf(s),
        rate: s.payment?.fixed?.price ? `${s.payment.fixed.price.value} ${s.payment.fixed.price.currency}` : (s.payment?.rateType ?? null),
        resourceType: s.primaryResourceType ?? null,
        resourceCount: (s.serviceResources ?? []).reduce((n, sr) => n + (sr.resourceIds?.values ?? []).length, 0),
        media: s.media?.mainMedia ? 1 : 0,
      })),
      resourceTypes: (types?.resourceTypes ?? []).map((t) => ({ id: t.id, name: t.name })),
      resources: (resources?.resources ?? []).map((r) => ({ id: r.id, name: r.name, typeId: r.typeId ?? null })),
    };
  },
});
