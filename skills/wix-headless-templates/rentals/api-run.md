# Rentals: the calls of a build through the Wix tools

For steps 3 to 5 of the cold start (`wix-headless-cold-start/headless-kit.md`): the call that
installs the app and creates the rentals, what the pages import, and the visitor read for the
check.

## Steps 3 and 4: install the app and create the rentals

One `ExecuteWixAPI` function with `siteId` and `scope: 'site'`. Change only the plan at the top.

```javascript
async function run() {
  const plan = {
    currency: 'USD',
    resourceTypes: [
      { name: 'Kayaks', resources: ['Kayak 1', 'Kayak 2', 'Kayak 3'] },
      { name: 'Cabins', resources: ['Lakeside cabin'] }
    ],
    rentals: [
      { name: 'Single kayak', tagLine: 'Paddle the bay at your pace', description: 'A single kayak with a paddle and a vest.',
        unit: 'HOUR', rate: 25, min: 1, max: 6, resourceType: 'Kayaks',
        imageUrl: 'https://images.unsplash.com/photo-1472745942893-4b9f730c7668?w=1200' },
      { name: 'Lakeside cabin', description: 'Two rooms and a deck on the water.',
        unit: 'DAY', rate: 180, min: 2, max: 7, resourceType: 'Cabins', requireManualApproval: true },
      { name: 'Life jacket', description: 'One vest, any size.', unit: 'HOUR', free: true, max: 8,
        resourceType: 'Kayaks', resources: ['Kayak 1'] }
    ]
  };

  const RENTALS_APP_ID = 'ff5d6eb1-65e4-4f9a-8b14-64d34c12cc2e';
  const api = async (method, path, body) =>
    (await wix.request({ scope: 'site', method, url: `https://www.wixapis.com${path}`, body })).data;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  await api('POST', '/apps-installer-service/v1/app-instance/install',
    { tenant: { tenantType: 'SITE', id: siteId }, appInstance: { appDefId: RENTALS_APP_ID, enabled: true } });

  // Resource types and resources: reuse one with the same name, create the rest.
  let haveTypes;
  for (let i = 0; i < 10 && !haveTypes; i++) {                 // a new install finishes in the background
    try {
      haveTypes = (await api('POST', '/bookings/v2/resources/resource-types/query',
        { query: { cursorPaging: { limit: 100 } } })).resourceTypes || [];
    } catch (e) {
      if (i === 9) throw e;
      await wait(2000);
    }
  }
  const types = {};
  for (const t of plan.resourceTypes) {
    let typeId = haveTypes.find((x) => x.name === t.name)?.id;
    if (!typeId) typeId = (await api('POST', '/bookings/v2/resources/resource-types', { resourceType: { name: t.name } })).resourceType.id;
    const have = (await api('POST', '/bookings/v2/resources/query',
      { query: { filter: { typeId }, cursorPaging: { limit: 100 } } })).resources || [];
    const resources = [];
    for (const name of t.resources) {
      const id = have.find((x) => x.name === name)?.id
        || (await api('POST', '/bookings/v2/resources', { resource: { name, typeId } })).resource.id;
      resources.push({ id, name });
    }
    types[t.name] = { id: typeId, resources };
  }

  const created = [];
  const failed = [];
  for (const r of plan.rentals) {
    const type = types[r.resourceType];
    const units = type.resources.filter((x) => !r.resources || r.resources.includes(x.name)).map((x) => x.id);
    const durationRange = r.unit === 'DAY'
      ? { unitType: 'DAY', dayOptions: { minDurationInDays: r.min || 1, maxDurationInDays: r.max || 5 } }
      : { unitType: 'HOUR', hourOptions: { minDurationInMinutes: (r.min || 1) * 60, maxDurationInMinutes: (r.max || 8) * 60 } };
    const payment = r.free || !r.rate
      ? { rateType: 'NO_FEE', options: { online: false, inPerson: true } }
      : { rateType: 'FIXED', fixed: { price: { value: Number(r.rate).toFixed(2), currency: plan.currency } },
          options: { online: true, inPerson: false } };
    const service = {
      type: 'APPOINTMENT', appId: RENTALS_APP_ID, name: r.name, description: r.description, tagLine: r.tagLine,
      defaultCapacity: 1,
      serviceResources: [{ resourceType: { id: type.id }, resourceIds: { values: units } }],
      primaryResourceType: type.id,
      form: { id: '3a2ea2ce-91f4-4617-ab24-629933c0c31a' },
      onlineBooking: { enabled: true, requireManualApproval: r.requireManualApproval === true, allowMultipleRequests: false },
      schedule: { availabilityConstraints: { durationRange } },
      payment,
      locations: [{ type: 'BUSINESS' }]
    };
    try {
      let s = (await api('POST', '/bookings/v2/services', { service })).service;
      // The picture: imageUrl is imported into the site's media, imageMediaId is a file already there.
      if (r.imageUrl || r.imageMediaId) {
        const file = r.imageMediaId
          ? (await api('GET', `/site-media/v1/files/get-file-by-id?fileId=${encodeURIComponent(r.imageMediaId)}`)).file
          : (await api('POST', '/site-media/v1/files/import',
              { url: r.imageUrl, mimeType: 'image/png', displayName: `${s.mainSlug?.name || 'rental'}.png` })).file;
        const image = { id: file.id, url: file.url };
        s = (await api('PATCH', `/bookings/v2/services/${s.id}`, { service: { id: s.id, revision: s.revision,
          media: { mainMedia: { image }, coverMedia: { image } } } })).service;
      }
      created.push({ id: s.id, name: s.name, slug: s.mainSlug?.name,
        unit: s.schedule?.availabilityConstraints?.durationRange?.unitType, image: !!s.media?.mainMedia });
    } catch (e) {
      failed.push({ name: r.name, error: String(e.message).slice(0, 300) });
    }
  }
  return { rentals: created, resourceTypes: types, failed };
}
```

A rental takes `unit` (`HOUR` or `DAY`) with `min` and `max` in that unit, a `rate` for one unit or
`free: true`, `requireManualApproval`, `resources` to rent only some units of its type, and a
picture as `imageUrl` or as `imageMediaId`, a file in the site's Media Manager. `currency` is the
currency of the site. A resource type or a resource with a name that the site already has is used
as it is.

## Step 5: what the pages import

- The list of rentals: `createRentalsStore(options)` in `/js/wix/rentals-store.js`.
- The booking of one rental: `createRentalFlowStore(rental)` in `/js/wix/rental-flow-store.js`.
- The reads: `fetchRentals` and `fetchRentalBySlug` in `/js/wix/rentals.js`.

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
    body: JSON.stringify({ query: { filter: { appId: 'ff5d6eb1-65e4-4f9a-8b14-64d34c12cc2e', hidden: false }, paging: { limit: 20, offset: 0 } } }) });
  const data = await res.json();
  return { status: res.status, names: (data.services || []).map((x) => x.name) };
}
```

The check passes when the names are the rentals that step 4 created.
