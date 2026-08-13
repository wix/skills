// Wix Events (Events V3) seed helpers — run at BUILD TIME via exec_tool (NOT shipped in the app).
// The agent requires this and calls the functions with plain data; all Wix Events request/response
// mechanics (the draft→tickets→publish order, the TICKETING-vs-RSVP registration block, the decimal
// STRING price, the v1 Categories API, the mainImage object) live here, once.
//
// NOT yet live-verified — transcribed from setup-events.md. Endpoints/fields are as written in the
// recipe; if a live call disagrees, trust the docs.
//
// Usage (build-time exec_tool):
//   const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");  // Base44 (generic: use $TOKEN)
//   const seed = require("/app/.agents/skills/wix-vibe-headless/references/events/seed/seed-events.js");
//   const ctx = { token: accessToken, siteId: WIX_METASITE_ID };
//
//   // setupEvents installs the Wix Events app first (installEventsApp) — base44 sites may not have it.
//
//   // STEP 1: create each event as a DRAFT (TICKETING = paid tiers | RSVP = free built-in form)
//   const ev = await seed.createEvent(ctx, {
//     title: "Summer Synth Festival", shortDescription: "One night of analog sound.",
//     type: "TICKETING", startDate: "2026-10-01T03:30:00.000Z", endDate: "2026-10-01T07:00:00.000Z",
//     timeZoneId: "America/Los_Angeles",
//     location: { name: "The Echo Lot", type: "VENUE", address: { addressLine: "120 Harbor St", city: "Seattle", subdivision: "US-WA", postalCode: "98101", country: "US" } },
//   });
//   // STEP 2 (TICKETING only): add ticket tiers BEFORE publish
//   const tiers = await seed.createTicketTiers(ctx, ev.id, [{ name: "General Admission", price: "65.00", initialLimit: 200 }]);
//   // STEP 3: publish (one-way)
//   await seed.publishEvent(ctx, ev.id);
//   // STEP 4 (optional): group by format/track
//   const cats = await seed.createEventCategories(ctx, ["Talks"]);
//   await seed.assignEventsToCategory(ctx, cats[0].id, [ev.id]);
//   // Attach images (optional): import the url to Wix Media first (events binds by file id), then patch.
//   const file = await seed.importImage(ctx, imageUrl);   // → { id, url } (Wix Media file id + wixstatic url)
//   await seed.setEventMainImage(ctx, { eventId: ev.id, id: file.id, url: file.url, height: 1024, width: 1024, altText: ev.slug });
//
// If any call fails with a shape the caller didn't expect, fall back to the wix-docs skill
// (search + read the live Wix API reference) — never guess. Source recipe (authoritative):
// wix-headless/references/inline-recipes/setup-events.md.

const API = "https://www.wixapis.com";
// Wix Events app id — installEventsApp installs it before seeding (base44 sites may not have it).
const EVENTS_APP_ID = "140603ad-af8d-84a5-2c80-a0f60cb47351";

async function req(ctx, path, { method = "POST", body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      "wix-site-id": ctx.siteId,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  return json;
}

// {type:"TICKETING"|"RSVP", ...} -> Wix registration block. TICKETING carries a tickets{} config;
// RSVP carries an rsvp{responseType} and seeds NO form fields (name+email form is built-in).
// initialType is IMMUTABLE after create — set from the request, never plan to convert.
function buildRegistration(ev) {
  if (ev.type === "TICKETING") {
    return {
      initialType: "TICKETING",
      tickets: {
        ticketLimitPerOrder: ev.ticketLimitPerOrder ?? 8, // per recipe (example value)
        currency: ev.currency ?? "USD", // setupEvents threads the site currency; USD only as last-resort fallback
        reservationDurationInMinutes: ev.reservationDurationInMinutes ?? 20, // per recipe (example value)
      },
    };
  }
  return {
    initialType: "RSVP",
    rsvp: { responseType: ev.rsvpResponseType ?? "YES_ONLY" }, // "YES_ONLY" | "YES_AND_NO"
  };
}

// ---- exported operations ----

/**
 * STEP 1 — create ONE event as a draft (no bulk endpoint; loop for multiple events).
 * @param ev { title, shortDescription?, type:"TICKETING"|"RSVP",
 *   startDate, endDate, timeZoneId, showTimeZone?,   // dates are ISO-8601 UTC and MUST be in the future
 *   location,                                         // {name,type:"VENUE",address:{…}} | {name,type:"ONLINE"} | {locationTbd:true,name}
 *   ticketLimitPerOrder?, currency?, reservationDurationInMinutes?,  // TICKETING only
 *   rsvpResponseType? }                                              // RSVP only
 * @returns { id, slug }  (id feeds STEP 2/3; slug is the URL identifier — do NOT confuse with id)
 */
async function createEvent(ctx, ev) {
  const body = {
    draft: true,
    event: {
      title: ev.title,
      shortDescription: ev.shortDescription,
      location: ev.location,
      dateAndTimeSettings: {
        startDate: ev.startDate,
        endDate: ev.endDate,
        timeZoneId: ev.timeZoneId,
        showTimeZone: ev.showTimeZone ?? true, // per recipe (example value)
      },
      registration: buildRegistration(ev),
    },
    fields: ["DETAILS", "TEXTS", "REGISTRATION", "URLS"],
  };
  const r = await req(ctx, "/events/v3/events", { body });
  return { id: r.event?.id, slug: r.event?.slug };
}

/**
 * STEP 2 — create ticket definitions for a TICKETING event (skip for RSVP). Must run BEFORE publish.
 * Tiers for one event are independent — fired as one parallel batch.
 * @param tiers [{ name (<=30 chars), description?, price (decimal STRING, e.g. "65.00"),
 *   currency?, initialLimit? (omit for unlimited), feeType? ("FEE_INCLUDED"|"FEE_ADDED_AT_CHECKOUT"|"NO_FEE") }]
 * @returns [{ id }]  (frontend lists tiers and reserves by ticketDefinition id)
 */
async function createTicketTiers(ctx, eventId, tiers) {
  return Promise.all(tiers.map(async (t) => {
    const body = {
      ticketDefinition: {
        eventId,
        name: t.name,
        description: t.description,
        ...(t.initialLimit != null ? { initialLimit: t.initialLimit } : {}), // omit => unlimited
        pricingMethod: { fixedPrice: { value: String(t.price), currency: t.currency ?? "USD" } }, // value = decimal string; currency = site currency (threaded by setupEvents), USD only as fallback
        feeType: t.feeType ?? "FEE_INCLUDED", // per recipe (default)
      },
      fields: ["SALES_DETAILS"],
    };
    const r = await req(ctx, "/events/v3/ticket-definitions", { body });
    return { id: r.ticketDefinition?.id };
  }));
}

// STEP 3 — publish the event (one-way). For a TICKETING event, publish only AFTER its tiers exist.
async function publishEvent(ctx, eventId) {
  return req(ctx, `/events/v3/events/${eventId}/publish`, { body: {} });
}

// STEP 4 (optional) — group events by a format/track. Categories are the v1 API (NOT v3). One call each.
async function createEventCategories(ctx, names) {
  const out = [];
  for (const name of names) {
    const r = await req(ctx, "/events/v1/categories", { body: { category: { name } } });
    out.push({ id: r.category?.id, name });
  }
  return out;
}

// Assign events to a category. Path is /{categoryId}/events (NOT /assign); body key is `eventId` (array).
async function assignEventsToCategory(ctx, categoryId, eventIds) {
  return req(ctx, `/events/v1/categories/${categoryId}/events`, { body: { eventId: eventIds } });
}

// Import an external image URL into Wix Media → { id, url }. Events binds mainImage by the Wix Media
// file **id**, NOT a url — an external url (e.g. a base44 generate_image result) MUST be imported
// first; the raw url as the id stores (200) but renders nothing. id = wixstatic file id, url = the
// permanent wixstatic url.
async function importImage(ctx, url, displayName = "image.png") {
  const r = await req(ctx, "/site-media/v1/files/import", { body: { url, mimeType: "image/png", displayName } });
  const f = r.file || r;
  if (!f?.id) throw new Error(`import-file returned no file id: ${JSON.stringify(r).slice(0, 200)}`);
  return { id: f.id, url: f.url };
}

// Attach images (optional). mainImage is an Image OBJECT; height/width are REQUIRED or it won't
// render. Events V3 uses NO revision — partial PATCH keyed by event.id. Works before OR after publish.
// item: { eventId, id, url, height, width, altText }  (id = the WixMedia image id, from importImage)
async function setEventMainImage(ctx, item) {
  return req(ctx, `/events/v3/events/${item.eventId}`, {
    method: "PATCH",
    body: {
      event: {
        id: item.eventId,
        mainImage: { id: item.id, url: item.url, height: item.height, width: item.width, altText: item.altText },
      },
      fields: ["DETAILS"], // mainImage reads back only under DETAILS
    },
  });
}

/**
 * ONE-CALL seed: per event create DRAFT → (ticketed) add tiers → publish, then create + assign
 * named categories and attach main images — in the correct order, keeping created ids in memory
 * (no hand-threading of event ids across exec calls). DEFAULT path.
 * @param plan {{ events: [{
 *   ...createEvent fields (title, shortDescription?, type, startDate, endDate, timeZoneId, location, …),
 *   ticketTiers?: [{ name, price, initialLimit?, … }],   // TICKETING only; omit to skip
 *   category?: string,                                     // category NAME; resolved to id + assigned
 *   imageUrl?: string                                      // a plain image url; imported to Wix Media here, optional
 * }] }}
 */
// Install the Wix Events app so seeding self-provisions — base44 sites aren't guaranteed to have it
// (there's no separate Setup step here, unlike the wix-headless recipe this was ported from). Idempotent:
// re-installing an already-installed app returns 200 (verified), so it's safe to call unconditionally.
async function installEventsApp(ctx) {
  return req(ctx, "/apps-installer-service/v1/app-instance/install", { body: {
    tenant: { tenantType: "SITE", id: ctx.siteId },
    appInstance: { appDefId: EVENTS_APP_ID, enabled: true },
  } });
}

// Ticket prices are in the SITE's currency. The ticket-definitions API REQUIRES `currency` and does
// not infer it (omitting it 400s), and it does NOT fall back to the site currency — whatever you pass
// is used verbatim. So resolve the site's payment currency once and thread it through, instead of a
// hardcoded default that would mis-price tickets on a non-USD site (e.g. USD tickets on a EUR/ILS site).
async function getSiteCurrency(ctx) {
  try {
    const r = await req(ctx, "/site-properties/v4/properties", { method: "GET" });
    return r?.properties?.paymentCurrency || "USD";
  } catch { return "USD"; }
}

async function setupEvents(ctx, { events = [] } = {}) {
  await installEventsApp(ctx);
  const siteCurrency = await getSiteCurrency(ctx);
  const created = [];
  for (const ev of events) {
    const e = await createEvent(ctx, { ...ev, currency: ev.currency ?? siteCurrency });
    const tiers = ev.ticketTiers?.length
      ? await createTicketTiers(ctx, e.id, ev.ticketTiers.map((t) => ({ ...t, currency: t.currency ?? siteCurrency })))
      : [];
    await publishEvent(ctx, e.id);
    created.push({ ...e, category: ev.category, imageUrl: ev.imageUrl, ticketCount: tiers.length });
  }
  const names = [...new Set(created.map((e) => e.category).filter(Boolean))];
  const cats = names.length ? await createEventCategories(ctx, names) : [];
  for (const c of cats) {
    const eventIds = created.filter((e) => e.category === c.name).map((e) => e.id);
    await assignEventsToCategory(ctx, c.id, eventIds);
  }
  let imagesAttached = 0;
  for (const e of created) {
    if (!e.imageUrl) continue;
    try {
      const file = await importImage(ctx, e.imageUrl, `${e.slug || "event"}.png`);   // → Wix Media file id
      await setEventMainImage(ctx, { eventId: e.id, id: file.id, url: file.url, height: 1024, width: 1024, altText: e.slug });
      imagesAttached++;
    } catch { /* never block on image failure — leave the event image-less */ }
  }
  return {
    events: created.map((e) => ({ id: e.id, slug: e.slug, ticketCount: e.ticketCount, category: e.category ?? null })),
    categories: cats,
    imagesAttached,
  };
}

module.exports = {
  setupEvents,
  createEvent, createTicketTiers, publishEvent,
  installEventsApp, getSiteCurrency, createEventCategories, assignEventsToCategory, importImage, setEventMainImage,
};
