# Events: the calls of a build through the Wix tools

For steps 4 and 5 of the cold start (`wix-headless-cold-start/headless-kit.md`): the call that
creates the events, what the pages import, and the visitor read for the check.

## Step 4: create the events

One `ExecuteWixAPI` function with `siteId` and `scope: 'site'`. Change only the plan at the top.

```javascript
async function run() {
  const plan = {
    events: [
      { type: 'TICKETING', title: 'Summer Synth Festival', shortDescription: 'One night of analog sound under the stars.',
        startDate: '2027-06-12T03:30:00.000Z', endDate: '2027-06-12T07:00:00.000Z', timeZoneId: 'America/Los_Angeles',
        location: { name: 'The Echo Lot', type: 'VENUE',
          address: { addressLine: '120 Harbor St', city: 'Seattle', subdivision: 'US-WA', postalCode: '98101', country: 'US' } },
        ticketTiers: [
          { name: 'General Admission', price: '45.00', initialLimit: 200 },
          { name: 'Front Row', price: '85.00', description: 'The first two rows.', initialLimit: 40 }
        ],
        category: 'Concerts',
        imageUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=1200' },
      { type: 'RSVP', title: 'Community Listening Night', shortDescription: 'Bring a record.',
        startDate: '2027-06-20T19:00:00.000Z', endDate: '2027-06-20T22:00:00.000Z', timeZoneId: 'America/Los_Angeles',
        location: { name: 'The Back Room', type: 'VENUE',
          address: { addressLine: '120 Harbor St', city: 'Seattle', subdivision: 'US-WA', postalCode: '98101', country: 'US' } },
        rsvpLimit: 40, waitlist: true, guests: 2, category: 'Community' },
      { type: 'RSVP', title: 'Online Mixing Q and A', shortDescription: 'Ask the residents anything.',
        startDate: '2027-07-01T18:00:00.000Z', endDate: '2027-07-01T19:00:00.000Z', timeZoneId: 'America/Los_Angeles',
        location: { name: 'Live stream', type: 'ONLINE' },
        rsvpResponseType: 'YES_AND_NO', registrationOpensAt: '2027-06-01T00:00:00.000Z', category: 'Community' }
    ]
  };

  const api = async (method, path, body) =>
    (await wix.request({ scope: 'site', method, url: `https://www.wixapis.com${path}`, body })).data;
  const failed = [];

  // The currency is set first: a ticket price is stored in the currency the site has when the event is created.
  if (plan.currency) {
    await api('PATCH', '/site-properties/v4/properties',
      { properties: { paymentCurrency: plan.currency }, fields: { paths: ['paymentCurrency'] } });
  }
  const currency = plan.currency || (await api('GET', '/site-properties/v4/properties')).properties.paymentCurrency;

  const registration = (ev) => (ev.type === 'TICKETING'
    ? { initialType: 'TICKETING', tickets: { ticketLimitPerOrder: ev.ticketLimitPerOrder || 8, currency,
        reservationDurationInMinutes: 20 } }
    : { initialType: 'RSVP', rsvp: { responseType: ev.rsvpResponseType || 'YES_ONLY',
        ...(ev.rsvpLimit ? { limit: ev.rsvpLimit } : {}),
        ...(ev.waitlist ? { waitlistEnabled: true } : {}),
        ...(ev.registrationOpensAt
          ? { startDate: ev.registrationOpensAt, endDate: ev.registrationClosesAt || ev.startDate } : {}) } });

  const made = [];
  for (const ev of plan.events) {
    const event = (await api('POST', '/events/v3/events', { draft: true,
      event: { title: ev.title, shortDescription: ev.shortDescription, location: ev.location,
        dateAndTimeSettings: { startDate: ev.startDate, endDate: ev.endDate, timeZoneId: ev.timeZoneId, showTimeZone: true },
        registration: registration(ev) },
      fields: ['DETAILS', 'TEXTS', 'REGISTRATION', 'URLS'] })).event;

    // The ticket types are created before the event is published. Wix refuses a fee type the site cannot use.
    let tickets = 0;
    for (const t of (ev.type === 'TICKETING' && ev.ticketTiers) || []) {
      for (const feeType of [t.feeType || 'FEE_INCLUDED', 'NO_FEE', 'FEE_ADDED_AT_CHECKOUT']) {
        try {
          await api('POST', '/events/v3/ticket-definitions', { ticketDefinition: { eventId: event.id, name: t.name,
            description: t.description, ...(t.initialLimit != null ? { initialLimit: t.initialLimit } : {}),
            pricingMethod: { fixedPrice: { value: String(t.price), currency } }, feeType }, fields: ['SALES_DETAILS'] });
          tickets++;
          break;
        } catch (e) {
          if (!/INVALID_FEE_TYPE/.test(String(e.message)) || feeType === 'FEE_ADDED_AT_CHECKOUT') {
            failed.push({ event: ev.title, ticket: t.name, error: String(e.message).slice(0, 200) });
            break;
          }
        }
      }
    }

    // Guests that one RSVP may bring are a control of the registration form.
    if (ev.type === 'RSVP' && ev.guests) {
      try {
        await api('POST', `/events/v1/events/${event.id}/form/control`, { additionalGuests: { maxGuests: ev.guests,
          namesMandatory: false, labels: { single: 'Bringing a guest?', multiple: 'How many guests?' } } });
      } catch (e) {
        failed.push({ event: ev.title, guests: String(e.message).slice(0, 200) });
      }
    }

    await api('POST', `/events/v3/events/${event.id}/publish`, {});
    made.push({ plan: ev, id: event.id, slug: event.slug, tickets });
  }

  // Categories: reuse one with the same name, create the rest, then assign the events.
  const names = [...new Set(made.map((m) => m.plan.category).filter(Boolean))];
  if (names.length) {
    const have = (await api('POST', '/events/v1/categories/query', { query: { paging: { limit: 100 } } })).categories || [];
    for (const name of names) {
      const id = have.find((c) => c.name === name)?.id ||
        (await api('POST', '/events/v1/categories', { category: { name } })).category.id;
      await api('POST', `/events/v1/categories/${id}/events`,
        { eventId: made.filter((m) => m.plan.category === name).map((m) => m.id) });
    }
  }

  // Images: imageUrl or imageMediaId on an event.
  let images = 0;
  for (const m of made.filter((x) => x.plan.imageUrl || x.plan.imageMediaId)) {
    try {
      const file = m.plan.imageMediaId
        ? { id: m.plan.imageMediaId, url: `https://static.wixstatic.com/media/${m.plan.imageMediaId}` }
        : (await api('POST', '/site-media/v1/files/import',
          { url: m.plan.imageUrl, mimeType: 'image/png', displayName: `${m.slug}.png` })).file;
      await api('PATCH', `/events/v3/events/${m.id}`, { event: { id: m.id,
        mainImage: { id: file.id, url: file.url, width: 1024, height: 1024, altText: m.plan.title } }, fields: ['DETAILS'] });
      images++;
    } catch (e) {
      failed.push({ event: m.plan.title, image: String(e.message).slice(0, 200) });
    }
  }

  return { events: made.map((m) => ({ id: m.id, title: m.plan.title, slug: m.slug, tickets: m.tickets })),
    categories: names, images, failed };
}
```

The plan accepts `currency` at the top. An event has a `type` of `TICKETING` or `RSVP`, which cannot
change later, dates in the future in UTC, a `timeZoneId`, and a `location` of type `VENUE` with an address or
of type `ONLINE`. A ticketed event has `ticketTiers`, each with a `name`, a `price` as a decimal string, and
optionally a `description`, an `initialLimit` and a `feeType`. An RSVP event can have `rsvpResponseType`,
`rsvpLimit`, `waitlist`, `guests`, and `registrationOpensAt` with `registrationClosesAt`. Any event can have a
`category` and an image as `imageUrl` or as `imageMediaId`, the id of a file in the Media Manager of the site.

## Step 5: what the pages import

- The list of events: `createEventsStore({ pageSize, status })` in `/js/wix/events-store.js`.
- The registration for one event: `createRegistrationStore(event, { paths })` in
  `/js/wix/registration-store.js`.
- The reads: `fetchEvents` and `fetchEventBySlug` in `/js/wix/events.js`.

A name that a module does not export stops the whole page. `static.md` shows how to use each one.

## Step 5: the visitor read

```javascript
async function run() {
  const clientId = '<appId from step 2>';
  const tokenRes = await fetch('https://www.wixapis.com/oauth2/token', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, grantType: 'anonymous' }) });
  const token = (await tokenRes.json()).access_token;
  const res = await fetch('https://www.wixapis.com/events/v3/events/query', { method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { filter: { status: { $in: ['UPCOMING', 'STARTED'] } }, paging: { limit: 20, offset: 0 } } }) });
  const data = await res.json();
  return { status: res.status, count: (data.events || []).length, titles: (data.events || []).map((x) => x.title) };
}
```

The check passes when the titles are the events that step 4 created.
