# Bookings: the calls of a build through the Wix tools

For steps 4 and 5 of the cold start (`wix-headless-cold-start/headless-kit.md`): the call that
creates the services, what the pages import, and the visitor read for the check.

## Step 4: create the services

One `ExecuteWixAPI` function with `siteId` and `scope: 'site'`. Change only the plan at the top.

```javascript
async function run() {
  const plan = {
    staff: ['Maya Lin'],
    locations: [{ name: 'Downtown studio', timeZone: 'America/New_York',
      address: { formattedAddress: '12 5th Street, New York', city: 'New York', country: 'US' } }],
    services: [
      { type: 'APPOINTMENT', name: 'Deep Tissue Massage', tagLine: 'An hour of relief',
        description: 'Slow, firm work on the back and shoulders.', price: 85, deposit: 20, payInFull: true,
        duration: 60, category: 'Massage', staff: 'Maya Lin',
        imageUrl: 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=1200' },
      { type: 'APPOINTMENT', name: 'Intro Consultation', description: 'A first talk about what you need.',
        free: true, duration: 30, category: 'Massage', requireManualApproval: true },
      { type: 'APPOINTMENT', name: 'Custom Treatment', description: 'Planned with you.',
        priceText: 'Ask for a quote', duration: 90, category: 'Massage', location: 'Downtown studio' },
      { type: 'CLASS', name: 'Morning Yoga', description: 'A gentle start to the day.', price: { from: 20 },
        capacity: 12, waitlist: 4, maxParticipants: 3, category: 'Classes',
        weekly: { days: ['MONDAY', 'WEDNESDAY'], time: '09:00', duration: 60, start: '2027-01-04', end: '2027-03-28' },
        sessions: [{ start: '2027-01-02T09:00:00', end: '2027-01-02T10:00:00' }] },
      { type: 'COURSE', name: 'Six Week Pottery Course', description: 'From the first pinch pot to a glazed bowl.',
        price: 240, capacity: 8, category: 'Courses',
        weekly: { days: ['TUESDAY'], time: '18:00', duration: 120, start: '2027-01-05', end: '2027-02-09' } }
    ]
  };

  const api = async (method, path, body) =>
    (await wix.request({ scope: 'site', method, url: `https://www.wixapis.com${path}`, body })).data;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const failed = [];

  // The currency is set first: a price is stored in the currency the site has when the service is created.
  if (plan.currency) {
    await api('PATCH', '/site-properties/v4/properties',
      { properties: { paymentCurrency: plan.currency }, fields: { paths: ['paymentCurrency'] } });
  }
  const currency = plan.currency || (await api('GET', '/site-properties/v4/properties')).properties.paymentCurrency;
  const money = (n) => ({ value: String(n), currency });

  // Staff: a new install makes the first staff member in the background. The plan's names are added.
  const readStaff = async () => (await api('POST', '/bookings/v1/staff-members/query',
    { query: {}, fields: ['RESOURCE_DETAILS'] })).staffMembers || [];
  let staff = [];
  for (let i = 0; i < 15 && !staff.length; i++) {
    staff = await readStaff();
    if (!staff.length) await wait(2000);
  }
  const firstStaff = staff[0].resourceId;
  const wantedStaff = [...new Set([...(plan.staff || []), ...plan.services.flatMap((s) => list(s.staff))])];
  for (const name of wantedStaff) {
    if (!staff.some((m) => m.name === name)) {
      await api('POST', '/bookings/v1/staff-members', { staffMember: { name }, fields: ['RESOURCE_DETAILS'] });
    }
  }
  for (let i = 0; i < 10 && wantedStaff.some((n) => !staff.find((m) => m.name === n)?.resourceId); i++) {
    await wait(2000);
    staff = await readStaff();
  }
  const staffIds = (s) => {
    const ids = list(s.staff).map((n) => staff.find((m) => m.name === n)?.resourceId).filter(Boolean);
    return ids.length ? ids : [firstStaff];
  };

  // Locations and categories: one with the same name is reused.
  const locationId = {};
  if ((plan.locations || []).length) {
    const have = (await api('GET', '/locations/v1/locations')).locations || [];
    for (const l of plan.locations) {
      locationId[l.name] = have.find((x) => x.name === l.name)?.id || (await api('POST', '/locations/v1/locations',
        { location: { name: l.name, timeZone: l.timeZone, address: l.address || { formattedAddress: l.name } } })).location.id;
    }
  }
  const categoryId = {};
  const haveCats = (await api('POST', '/bookings/v2/categories/query', { query: {} })).categories || [];
  for (const name of new Set(plan.services.map((s) => s.category || 'Services'))) {
    categoryId[name] = haveCats.find((c) => c.name === name)?.id ||
      (await api('POST', '/bookings/v2/categories', { category: { name } })).category.id;
  }

  // A waitlist or a limit of seats in one booking is a booking policy of the service.
  const policyId = {};
  for (const s of plan.services.filter((x) => x.waitlist != null || x.maxParticipants != null)) {
    policyId[s.name] = (await api('POST', '/bookings/v1/booking-policies', { bookingPolicy: { name: `${s.name} policy`,
      ...(s.waitlist != null ? { waitlistPolicy: { enabled: true, capacity: s.waitlist, reservationTimeInMinutes: 10 } } : {}),
      ...(s.maxParticipants != null ? { participantsPolicy: { enabled: true, maxParticipantsPerBooking: s.maxParticipants } } : {}) } })).bookingPolicy.id;
  }

  const payment = (s) => {
    const deposit = s.deposit ? { deposit: money(s.deposit), fullUpfrontPaymentAllowed: s.payInFull === true } : {};
    if (s.price != null && typeof s.price === 'object') {
      return { rateType: 'VARIED', varied: { defaultPrice: money(s.price.from), ...deposit },
        options: { online: true, inPerson: false, deposit: !!s.deposit } };
    }
    if (s.priceText) return { rateType: 'CUSTOM', custom: { description: s.priceText }, options: { online: false, inPerson: true } };
    if (s.free || s.price == null) return { rateType: 'NO_FEE', options: { online: false, inPerson: true } };
    return { rateType: 'FIXED', fixed: { price: money(s.price), ...deposit },
      options: { online: true, inPerson: false, deposit: !!s.deposit } };
  };
  const services = plan.services.map((s) => ({
    type: s.type, name: s.name, description: s.description, tagLine: s.tagLine,
    defaultCapacity: s.capacity || (s.type === 'APPOINTMENT' ? 1 : undefined),
    onlineBooking: { enabled: true, requireManualApproval: s.requireManualApproval === true, allowMultipleRequests: false },
    payment: payment(s),
    category: { id: categoryId[s.category || 'Services'] },
    locations: [s.location ? { type: 'BUSINESS', business: { id: locationId[s.location] } } : { type: 'BUSINESS' }],
    ...(policyId[s.name] ? { bookingPolicy: { id: policyId[s.name] } } : {}),
    ...(s.type === 'APPOINTMENT'
      ? { schedule: { availabilityConstraints: { sessionDurations: [s.duration || 60] } }, staffMemberIds: staffIds(s) }
      : {})
  }));
  const created = await api('POST', '/bookings/v2/bulk/services/create', { services, returnEntity: true });
  const made = [];
  created.results.forEach((r, i) => {
    if (r.itemMetadata.success && r.item) made.push({ plan: plan.services[i], item: r.item });
    else failed.push({ name: plan.services[i].name, error: r.itemMetadata.error });
  });

  // Sessions of classes and courses: `weekly` repeats on each day until `end`, `sessions` are single ones.
  const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const stamp = (d) => d.toISOString().slice(0, 19);
  const events = [];
  for (const m of made.filter((x) => x.plan.type !== 'APPOINTMENT')) {
    const s = m.plan;
    const base = { scheduleId: m.item.schedule.id, type: s.type,
      resources: [{ id: staffIds(s)[0], permissionRole: 'WRITER' }],
      ...(s.capacity ? { totalCapacity: s.capacity } : {}) };
    for (const one of (s.type === 'CLASS' && s.sessions) || []) {
      events.push({ event: { ...base, start: { localDate: one.start }, end: { localDate: one.end } } });
    }
    for (const day of (s.weekly && s.weekly.days) || []) {
      const start = new Date(`${s.weekly.start}T${s.weekly.time || '09:00'}:00Z`);
      while (start.getUTCDay() !== DAYS.indexOf(day)) start.setUTCDate(start.getUTCDate() + 1);
      const end = new Date(start.getTime() + (s.weekly.duration || 60) * 60000);
      events.push({ event: { ...base, start: { localDate: stamp(start) }, end: { localDate: stamp(end) },
        recurrenceRule: { frequency: 'WEEKLY', interval: 1, days: [day], until: { localDate: `${s.weekly.end}T23:59:59` } } } });
    }
  }
  let sessions = 0;
  if (events.length) {
    const scheduled = await api('POST', '/calendar/v3/bulk/events/create', { events });
    for (const r of scheduled.results) {
      if (r.itemMetadata.success) sessions++;
      else failed.push({ session: r.itemMetadata.originalIndex, error: r.itemMetadata.error });
    }
  }

  // Images: imageUrl or imageMediaId on a service.
  let images = 0;
  for (const m of made.filter((x) => x.plan.imageUrl || x.plan.imageMediaId)) {
    try {
      const file = m.plan.imageMediaId
        ? { id: m.plan.imageMediaId, url: `https://static.wixstatic.com/media/${m.plan.imageMediaId}` }
        : (await api('POST', '/site-media/v1/files/import',
          { url: m.plan.imageUrl, mimeType: 'image/png', displayName: `${m.item.mainSlug.name}.png` })).file;
      const image = { id: file.id, url: file.url, width: 1024, height: 1024 };
      await api('PATCH', `/bookings/v2/services/${m.item.id}`, { service: { id: m.item.id, revision: m.item.revision,
        media: { mainMedia: { image }, coverMedia: { image } } } });
      images++;
    } catch (e) {
      failed.push({ name: m.plan.name, image: String(e.message).slice(0, 200) });
    }
  }

  return { services: made.map((m) => ({ id: m.item.id, name: m.item.name, slug: m.item.mainSlug.name, type: m.item.type })),
    staff: staff.map((m) => m.name), categories: Object.keys(categoryId), locations: Object.keys(locationId),
    sessions, images, failed };
}
```

The plan accepts `currency`, `staff` names and `locations` at the top. A service has a `type` of
`APPOINTMENT`, `CLASS` or `COURSE`, a `category`, and one price form: `price` as a number, `price: { from }`,
`priceText`, or `free: true`. It can also have `tagLine`, `deposit` with `payInFull`, `duration` in minutes,
`capacity`, `waitlist`, `maxParticipants`, `requireManualApproval`, `staff`, `location`, and an
image as `imageUrl` or as `imageMediaId`, the id of a file in the Media Manager of the site. A class or a
course gets its sessions from `weekly`; a class also from `sessions`. The times are local times, in the future.

## Step 5: what the pages import

- The list of services: `createServicesStore(options)` in `/js/wix/services-store.js`.
- The booking of one service: `createBookingFlowStore(service)` in `/js/wix/booking-flow-store.js`.
- The reads: `fetchServices` and `fetchServiceBySlug` in `/js/wix/services.js`.

A name that a module does not export stops the whole page. `static.md` shows how to use each one.

## Step 5: the visitor read

```javascript
async function run() {
  const clientId = '<appId from step 2>';
  const tokenRes = await fetch('https://www.wixapis.com/oauth2/token', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, grantType: 'anonymous' }) });
  const token = (await tokenRes.json()).access_token;
  const res = await fetch('https://www.wixapis.com/bookings/v2/services/query', { method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { paging: { limit: 20, offset: 0 } } }) });
  const data = await res.json();
  return { status: res.status, count: (data.services || []).length, names: (data.services || []).map((s) => s.name) };
}
```

The check passes when the names are the services that step 4 created.
