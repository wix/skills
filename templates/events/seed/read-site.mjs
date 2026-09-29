// What the events site holds: events and their ticket definitions.
//   node <SKILL_ROOT>/templates/events/seed/read-site.mjs [--site <siteId>] [--limit <n>]
import { runReader } from "../../shared/seed/read-site.mjs";

const EVENTS_APP_ID = "140603ad-af8d-84a5-2c80-a0f60cb47351";
const D = "https://dev.wix.com/docs/api-reference/business-solutions/events/event-management";

await runReader({
  vertical: "events",
  appId: EVENTS_APP_ID,
  async read(api, { limit }) {
    const ev = await api.call({ path: "/events/v3/events/query", body: { query: { filter: { status: { $ne: "CANCELED" } }, paging: { limit } }, fields: ["DETAILS", "REGISTRATION"] }, docs: `${D}/events-v3/query-events` });
    const td = await api.tryCall({ path: "/events-ticket-definitions/v3/ticket-definitions/query", body: { query: { paging: { limit: 100 } } }, docs: `${D}/ticket-definitions-v3/query-ticket-definitions` });
    const defs = td?.ticketDefinitions ?? [];
    return {
      eventCount: ev.pagingMetadata?.total ?? (ev.events ?? []).length,
      events: (ev.events ?? []).map((e) => ({
        title: e.title, slug: e.slug, status: e.status, start: e.dateAndTimeSettings?.startDate ?? null,
        location: e.location?.name ?? e.location?.type ?? null, registration: e.registration?.type ?? null,
        tickets: defs.filter((d) => d.eventId === e.id).map((d) => `${d.name}${d.pricingMethod?.fixedPrice?.formattedValue ? " " + d.pricingMethod.fixedPrice.formattedValue : ""}`),
        image: !!e.mainImage,
      })),
      ticketDefinitionCount: defs.length,
    };
  },
});
