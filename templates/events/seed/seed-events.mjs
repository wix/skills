// Events seed — a BUILD-TIME script, never shipped in the app. Run from the project root
// (where wix.config.json lives) with a plan file:
//
//   node <SKILL_ROOT>/templates/events/seed/seed-events.mjs plan.json
//
// It mints its own site token via the Wix CLI, installs the Wix Events app if needed,
// resolves the site currency, then per event: create DRAFT → (TICKETING) add ticket tiers →
// publish — the order two one-way constraints force (registration.initialType is immutable
// after create; publishing is one-way). Then it creates + assigns categories and
// imports+attaches images. Prints a JSON result to stdout.
//
// Plan shape (see SEED.md):
//   { "events": [{ "title", "shortDescription"?, "type": "TICKETING"|"RSVP",
//                  "startDate", "endDate" (future ISO-8601 UTC), "timeZoneId",
//                  "location" ({name,type:"VENUE",address} | {name,type:"ONLINE"} | {locationTbd:true,name}),
//                  "ticketTiers"?: [{ "name" (≤30 chars), "price" (decimal STRING), "description"?, "initialLimit"?, "feeType"? }],
//                  "category"? (name), "imageUrl"? | "imagePrompt"?, "rsvpResponseType"? }] }
//
// Seeding is ADDITIVE — never deletes or overwrites existing content. Unexpected shapes →
// read the live API reference; every call below
// carries a docs: line with its reference page.
import { setSiteCurrency } from "../../shared/seed/site.mjs";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolveItemImages } from "../../shared/seed/images.mjs";
import { seedSiteId } from "../../shared/seed/site-context.mjs";

const API = "https://www.wixapis.com";
const EVENTS_APP_ID = "140603ad-af8d-84a5-2c80-a0f60cb47351";

export function makeCtx({ cwd = process.cwd() } = {}) {
  // The content site: the config's site, or the parent on a migration preview (site-context.mjs stops
  // a seed there unless --allow-parent is passed after the user confirmed).
  const siteId = seedSiteId({ cwd, argv: process.argv });
  const token = execFileSync("npx", ["@wix/cli@latest", "token", "--site", siteId], {
    encoding: "utf8",
    cwd,
  }).trim();
  if (!token) throw new Error("The Wix CLI returned no token — run `npx @wix/cli@latest login` first.");
  return { token, siteId };
}

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

// {type:"TICKETING"|"RSVP", …} -> the registration block. TICKETING carries a tickets{}
// config; RSVP carries rsvp{responseType} and seeds NO form fields (name+email is built-in).
// initialType is IMMUTABLE after create — set from the plan, never plan to convert.
function buildRegistration(ev) {
  if (ev.type === "TICKETING") {
    return {
      initialType: "TICKETING",
      tickets: {
        ticketLimitPerOrder: ev.ticketLimitPerOrder ?? 8,
        currency: ev.currency ?? "USD", // setupEvents threads the site currency; USD is the last resort
        reservationDurationInMinutes: ev.reservationDurationInMinutes ?? 20,
      },
    };
  }
  return {
    initialType: "RSVP",
    rsvp: {
      responseType: ev.rsvpResponseType ?? "YES_ONLY", // "YES_ONLY" | "YES_AND_NO"
      ...(Number.isInteger(ev.rsvpLimit) && ev.rsvpLimit > 0 ? { limit: ev.rsvpLimit } : {}),
      ...(ev.waitlist === true ? { waitlistEnabled: true } : {}),
      // A future start date schedules the opening: the event publishes with status SCHEDULED_RSVP and
      // the page says when registration opens; before it, an RSVP is refused.
      ...(ev.registrationOpensAt ? { startDate: ev.registrationOpensAt } : {}),
    },
  };
}

// {guests: N} on an RSVP event -> a GUEST_CONTROL on the registration form: a count input (options
// "0".."N") and a names list capped at N. The site's form reader (events-core toRsvpForm) reads the
// max from either; the RSVP itself carries the answer as additionalGuestDetails, not as input values.
function buildForm(ev) {
  const n = Number(ev.guests);
  if (ev.type === "TICKETING" || !Number.isInteger(n) || n < 1) return undefined;
  return {
    controls: [
      {
        type: "GUEST_CONTROL",
        name: "guests",
        label: "Additional guests",
        orderIndex: 100,
        inputs: [
          { name: "additionalGuests", type: "NUMBER", label: "Additional guests", mandatory: false, options: Array.from({ length: n + 1 }, (_, i) => String(i)) },
          { name: "guestNames", type: "TEXT_ARRAY", array: true, label: "Guest names", mandatory: false, maxSize: n },
        ],
      },
    ],
  };
}

// ---- operations ----------------------------------------------------------------------------------

// Idempotent: re-installing an already-installed app returns 200.
// docs: https://dev.wix.com/docs/api-reference/articles/work-with-wix-apis/platform/about-apps-created-by-wix.md
export async function installEventsApp(ctx) {
  try {
    await req(ctx, "/apps-installer-service/v1/app-instance/install", { body: {
      tenant: { tenantType: "SITE", id: ctx.siteId },
      appInstance: { appDefId: EVENTS_APP_ID, enabled: true },
    } });
  } catch {
    /* already installed is fine */
  }
}

// The ticket-definitions API REQUIRES currency and uses whatever you pass verbatim (it does
// NOT fall back to the site currency) — resolve it once, or a non-USD site gets mis-priced.
// docs: https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/get-site-properties.md
export async function getSiteCurrency(ctx) {
  try {
    const r = await req(ctx, "/site-properties/v4/properties", { method: "GET" });
    return r?.properties?.paymentCurrency || "USD";
  } catch {
    return "USD";
  }
}

/**
 * STEP 1 — create ONE event as a draft (no bulk endpoint; loop for multiple). Dates MUST be
 * in the future — a past event isn't registerable and won't show in the live listing.
 * Returns { id, slug } — id feeds the tier/publish steps; slug is the URL identifier.
 * docs: https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/create-event.md
 */
export async function createEvent(ctx, ev) {
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
        showTimeZone: ev.showTimeZone ?? true,
      },
      registration: buildRegistration(ev),
      ...(buildForm(ev) ? { form: buildForm(ev) } : {}),
    },
    fields: ["DETAILS", "TEXTS", "REGISTRATION", "URLS", "FORM"],
  };
  let r;
  try {
    r = await req(ctx, "/events/v3/events", { body });
  } catch (e) {
    // The guest control's create shape is not in a public reference: when Wix rejects the form, the
    // event is created without it and the result says so (the owner adds guests in the dashboard).
    if (!body.event.form) throw e;
    delete body.event.form;
    r = await req(ctx, "/events/v3/events", { body });
    return { id: r.event?.id, slug: r.event?.slug, formRejected: String(e.message).slice(0, 200) };
  }
  return { id: r.event?.id, slug: r.event?.slug, guestControl: !!r.event?.form?.controls?.some((c) => c.type === "GUEST_CONTROL") };
}

/**
 * STEP 2 — ticket tiers for a TICKETING event (skip for RSVP). Must run BEFORE publish —
 * publishing a ticketed event with no tiers ships an event with nothing to buy, and there is
 * no un-publish. price is a decimal STRING ("65.00", never a number); name ≤ 30 chars; omit
 * initialLimit for unlimited. `feeType` is FEE_INCLUDED (the Wix fee comes out of the price),
 * FEE_ADDED_AT_CHECKOUT (the buyer pays it on top) or NO_FEE (free tickets and sites that don't
 * require a fee). Tiers are independent — fired as one parallel batch.
 * docs: https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/ticket-definitions-v3/create-ticket-definition.md
 */
export async function createTicketTiers(ctx, eventId, tiers) {
  return Promise.all(tiers.map(async (t) => {
    const body = (feeType) => ({
      ticketDefinition: {
        eventId,
        name: t.name,
        description: t.description,
        ...(t.initialLimit != null ? { initialLimit: t.initialLimit } : {}),
        pricingMethod: { fixedPrice: { value: String(t.price), currency: t.currency ?? "USD" } },
        feeType,
      },
      fields: ["SALES_DETAILS"],
    });
    // INVALID_FEE_TYPE ("feeType=FEE_INCLUDED feeRequired=false") means this site doesn't take a
    // fee on this tier — right after the Events app is installed the fee settings can also lag a
    // few seconds (seen on a fresh site, 2026-09-27). So the retries change the fee type instead
    // of re-sending the same one: the plan's (default FEE_INCLUDED), then NO_FEE, then
    // FEE_ADDED_AT_CHECKOUT after a five-second pause for the install race. Anything else, or a
    // third failure, throws as before.
    const feeTypes = [t.feeType ?? "FEE_INCLUDED", "NO_FEE", "FEE_ADDED_AT_CHECKOUT"];
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await req(ctx, "/events/v3/ticket-definitions", { body: body(feeTypes[attempt]) });
        return { id: r.ticketDefinition?.id, feeType: feeTypes[attempt] };
      } catch (e) {
        if (!/INVALID_FEE_TYPE/.test(e.message) || attempt >= 2) throw e;
        if (attempt === 1) await new Promise((res) => setTimeout(res, 5000));
      }
    }
  }));
}

// STEP 3 — publish (one-way; for TICKETING only after its tiers exist).
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/publish-draft-event.md
export async function publishEvent(ctx, eventId) {
  return req(ctx, `/events/v3/events/${eventId}/publish`, { body: {} });
}

// STEP 4 (optional) — group events by a format/track. Categories are the v1 API (NOT v3).
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/categories/create-category.md
export async function createEventCategories(ctx, names) {
  const out = [];
  for (const name of names) {
    const r = await req(ctx, "/events/v1/categories", { body: { category: { name } } });
    out.push({ id: r.category?.id, name });
  }
  return out;
}

// Assign events to a category. Path is /{categoryId}/events (NOT /assign); body key is
// `eventId` — an ARRAY despite the singular name.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/categories/assign-events.md
export async function assignEventsToCategory(ctx, categoryId, eventIds) {
  return req(ctx, `/events/v1/categories/${categoryId}/events`, { body: { eventId: eventIds } });
}

// Events binds mainImage by Wix Media file ID — an external url must be imported first
// (a raw url as the id stores 200 but renders nothing); a plan `imagePrompt` is generated
// (Wix AI, 1 credit) then imported. Both live in the shared util (parallel, resilient,
// never blocks the seed).
export { importImage } from "../../shared/seed/images.mjs";

// mainImage is an Image OBJECT; height/width are REQUIRED or it won't render. Events V3 uses
// NO revision — partial PATCH keyed by event.id. Works before OR after publish.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/update-event.md
export async function setEventMainImage(ctx, it) {
  return req(ctx, `/events/v3/events/${it.eventId}`, {
    method: "PATCH",
    body: {
      event: {
        id: it.eventId,
        mainImage: { id: it.id, url: it.url, height: it.height ?? 1024, width: it.width ?? 1024, altText: it.altText },
      },
      fields: ["DETAILS"], // mainImage reads back only under DETAILS
    },
  });
}

/**
 * ONE-CALL seed: install → site currency → per event create DRAFT → tiers → publish →
 * categories → images, ids threaded in memory. The default path.
 */
export async function setupEvents(ctx, { events = [], currency } = {}) {
  // Before any event exists: a ticket tier's currency is fixed at creation.
  if (currency) await setSiteCurrency(ctx, currency);
  await installEventsApp(ctx);
  const siteCurrency = currency ?? await getSiteCurrency(ctx);

  const created = [];
  for (const ev of events) {
    const e = await createEvent(ctx, { ...ev, currency: ev.currency ?? siteCurrency });
    if (!e.id) throw new Error(`Event "${ev.title}" was not created — no id returned.`);
    const tiers = ev.type === "TICKETING" && ev.ticketTiers?.length
      ? await createTicketTiers(ctx, e.id, ev.ticketTiers.map((t) => ({ ...t, currency: t.currency ?? siteCurrency })))
      : [];
    await publishEvent(ctx, e.id);
    created.push({ ...e, category: ev.category, imageUrl: ev.imageUrl, imagePrompt: ev.imagePrompt, ticketCount: tiers.length, feeTypes: tiers.map((t) => t.feeType) });
  }

  const names = [...new Set(created.map((e) => e.category).filter(Boolean))];
  const categories = names.length ? await createEventCategories(ctx, names) : [];
  for (const c of categories) {
    const eventIds = created.filter((e) => e.category === c.name).map((e) => e.id);
    if (eventIds.length) await assignEventsToCategory(ctx, c.id, eventIds);
  }

  // Pass 2 — images: resolve (import by url / generate by prompt) in one parallel wave, then
  // attach. Failures leave the event text-only; the seed's exit never depends on images.
  const files = await resolveItemImages(ctx, created.map((e) => ({
    url: e.imageUrl,
    path: e.imagePath,
    prompt: e.imagePrompt,
    displayName: `${e.slug || "event"}.png`,
  })));
  let imagesAttached = 0;
  for (let i = 0; i < created.length; i++) {
    const e = created[i];
    if (!files[i]) continue;
    try {
      await setEventMainImage(ctx, { eventId: e.id, id: files[i].id, url: files[i].url, height: 1024, width: 1024, altText: e.slug });
      imagesAttached++;
    } catch {
      /* never block on image failure — the event stays text-only */
    }
  }

  return {
    events: created.map((e) => ({ id: e.id, slug: e.slug, ticketCount: e.ticketCount, feeTypes: e.feeTypes, category: e.category ?? null })),
    categories,
    imagesAttached,
    // Completing a PAID purchase needs a premium plan + a configured payment method in the
    // dashboard — not a seeding failure; surface it to the owner. Free/RSVP need neither.
    notes: created.some((e) => e.ticketCount > 0)
      ? ["Paid tickets require a premium plan + a configured payment method in the dashboard to complete a purchase."]
      : [],
  };
}

// ---- CLI entry ----------------------------------------------------------------------------------

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (invokedDirectly) {
  const planPath = process.argv[2];
  if (!planPath) {
    console.error("usage: node seed-events.mjs <plan.json>   (run from the project root)");
    process.exit(1);
  }
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const ctx = makeCtx();
  setupEvents(ctx, plan)
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
