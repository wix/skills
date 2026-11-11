# Restaurants: the calls of a build through the Wix tools

For steps 3 to 5 of the cold start (`wix-headless-cold-start/headless-kit.md`): the call that
installs the app and creates the menu, what the pages import, and the visitor read for the
check.

## Steps 3 and 4: install the app and create the menu

One `ExecuteWixAPI` function with `siteId` and `scope: 'site'`. Change only the plan at the top.

```javascript
async function run() {
  const plan = {
    menus: [
      { name: 'Dinner', description: 'Evening menu', sections: [
        { name: 'Antipasti', description: 'To start', items: [
          { name: 'Burrata', description: 'Creamy burrata, heirloom tomatoes, olive oil.', price: 14,
            imageUrl: 'https://images.unsplash.com/photo-1608897013039-887f21d8c804?w=1200' }
        ] },
        { name: 'Mains', items: [
          { name: 'Tagliatelle al Ragu', description: 'Slow-braised beef ragu, parmigiano.', price: 22,
            acceptSpecialRequests: true,
            modifierGroups: [
              { name: 'Pasta', required: true, min: 1, max: 1, modifiers: [
                { name: 'Tagliatelle', preSelected: true }, { name: 'Pappardelle' }, { name: 'Gluten-free penne', price: 2 }] },
              { name: 'Extras', max: 3, modifiers: [{ name: 'Extra parmigiano', price: 1.5 }, { name: 'Chili flakes' }] }
            ] }
        ] },
        { name: 'Pizze', items: [
          { name: 'Margherita', description: 'San Marzano tomato, fior di latte, basil.',
            variants: [{ name: 'Small', price: 14 }, { name: 'Large', price: 22 }] }
        ] }
      ] }
    ],
    // Online ordering and table reservations need the address of the business.
    location: { name: 'Trattoria Lumina', timeZone: 'America/New_York',
      address: { country: 'US', subdivision: 'US-NY', city: 'New York', postalCode: '10012',
        streetAddress: { number: '18', name: 'Prince Street' },
        formattedAddress: '18 Prince Street, New York, NY 10012' } },
    ordering: true,
    reservations: { partySize: { min: 1, max: 10 } }
  };

  const api = async (method, path, body) =>
    (await wix.request({ scope: 'site', method, url: `https://www.wixapis.com${path}`, body })).data;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const install = (appDefId) => api('POST', '/apps-installer-service/v1/app-instance/install',
    { tenant: { tenantType: 'SITE', id: siteId }, appInstance: { appDefId, enabled: true } });
  // A new install finishes in the background: read until the list has an entry.
  const listWhenReady = async (path, key) => {
    for (let i = 0; i < 15; i++) {
      try {
        const list = (await api('GET', path))[key] || [];
        if (list.length) return list;
      } catch (e) { /* not ready yet */ }
      await wait(2000);
    }
    return [];
  };
  const ids = (res) => res.results.map((r) => (r.item || r.variant || r.modifier || r.modifierGroup)?.id);
  const money = (n) => String(n || 0);

  await install('b278a256-2757-4f19-9313-c05c783bec92');
  for (let i = 0; i < 8; i++) {
    try { await api('GET', '/restaurants/menus/v1/menus'); break; } catch (e) { if (i === 7) throw e; await wait(2000); }
  }

  const menus = [];
  const withImages = [];
  for (const menu of plan.menus) {
    const flat = menu.sections.flatMap((s, section) => s.items.map((it) => ({ ...it, section })));

    // Modifiers, then the groups that hold them, then the sizes, then the dishes.
    const groups = flat.flatMap((it, item) => (it.modifierGroups || []).map((g) => ({ ...g, item })));
    const modifiers = groups.flatMap((g) => g.modifiers);
    const modifierIds = modifiers.length ? ids(await api('POST', '/restaurants/menus/v1/bulk/modifiers/create',
      { returnEntity: true, modifiers: modifiers.map((m) => ({ name: m.name, inStock: m.inStock !== false })) })) : [];
    let next = 0;
    const groupIds = groups.length ? ids(await api('POST', '/restaurants/menus/v1/bulk/modifier-groups/create',
      { returnEntity: true, modifierGroups: groups.map((g) => ({
        name: g.name,
        modifiers: g.modifiers.map((m) => ({ id: modifierIds[next++], preSelected: m.preSelected === true,
          additionalChargeInfo: { additionalCharge: money(m.price) } })),
        rule: { required: g.required === true, minSelections: g.min ?? (g.required ? 1 : 0),
          ...(g.max != null ? { maxSelections: g.max } : {}) } })) })) : [];
    const variants = flat.flatMap((it) => it.variants || []);
    const variantIds = variants.length ? ids(await api('POST', '/restaurants/menus/v1/bulk/variants/create',
      { returnEntity: true, variants: variants.map((v) => ({ name: v.name })) })) : [];
    let nextVariant = 0;
    const bodies = flat.map((it, i) => ({
      name: it.name,
      ...(it.description ? { description: it.description } : {}),
      ...(it.variants
        ? { priceVariants: { variants: it.variants.map((v) => ({ variantId: variantIds[nextVariant++], priceInfo: { price: money(v.price) } })) } }
        : { priceInfo: { price: money(it.price) } }),
      ...(it.modifierGroups ? { modifierGroups: groupIds.filter((id, g) => groups[g].item === i).map((id) => ({ id })) } : {}),
      orderSettings: { inStock: it.inStock !== false, acceptSpecialRequests: it.acceptSpecialRequests === true },
      visible: true
    }));
    const items = (await api('POST', '/restaurants/menus/v1/bulk/items/create', { returnEntity: true, items: bodies }))
      .results.map((r) => r.item);

    const sectionIds = ids(await api('POST', '/restaurants/menus/v1/bulk/sections/create',
      { returnEntity: true, sections: menu.sections.map((s, section) => ({
        name: s.name, ...(s.description ? { description: s.description } : {}), visible: true,
        itemIds: items.filter((it, i) => it && flat[i].section === section).map((it) => it.id) })) }));
    const created = (await api('POST', '/restaurants/menus/v1/menus', { menu: { name: menu.name,
      ...(menu.description ? { description: menu.description } : {}), visible: true, sectionIds } })).menu;
    menus.push({ menuId: created.id, name: menu.name, sectionIds, itemIds: items.map((it) => it?.id) });
    flat.forEach((it, i) => {
      if (items[i] && (it.imageUrl || it.imageMediaId)) withImages.push({ plan: it, item: items[i], body: bodies[i] });
    });
  }

  // Pictures: imageUrl is imported into the site's media, imageMediaId is a file already there.
  let images = 0;
  const failed = [];
  const updates = [];
  for (const x of withImages) {
    try {
      const file = x.plan.imageMediaId
        ? (await api('GET', `/site-media/v1/files/get-file-by-id?fileId=${encodeURIComponent(x.plan.imageMediaId)}`)).file
        : (await api('POST', '/site-media/v1/files/import',
            { url: x.plan.imageUrl, mimeType: 'image/png', displayName: `${x.plan.name}.png` })).file;
      updates.push({ item: { ...x.body, id: x.item.id, revision: x.item.revision, image: { id: file.id, url: file.url, width: 1024, height: 1024 } } });
    } catch (e) {
      failed.push({ name: x.plan.name, error: String(e.message).slice(0, 200) });
    }
  }
  if (updates.length) {
    const res = await api('POST', '/restaurants/menus/v1/bulk/items/update', { items: updates });
    for (const r of res.results) {
      if (r.itemMetadata.success) images++;
      else failed.push({ name: updates[r.itemMetadata.originalIndex].item.name, error: r.itemMetadata.error });
    }
  }

  // The address is created when the site has none. An address that the site already has is kept.
  if (plan.location && (plan.ordering || plan.reservations)) {
    const have = (await api('GET', '/locations/v1/locations')).locations || [];
    if (!have.some((l) => l.default)) await api('POST', '/locations/v1/locations', { location: { ...plan.location, default: true } });
  }

  // Online ordering: the install creates the operation, this turns it on for every menu.
  const ordering = { enabled: false };
  if (plan.ordering) {
    await install('9a5d83fd-8570-482e-81ab-cfa88942ee60');
    const ops = await listWhenReady('/restaurants-operations/v1/operations', 'operations');
    const op = ops.find((o) => o.default) || ops[0];
    if (op) {
      if (op.onlineOrderingStatus !== 'ENABLED') {
        await api('PATCH', `/restaurants-operations/v1/operations/${op.id}`,
          { operation: { revision: op.revision, onlineOrderingStatus: 'ENABLED' } });
      }
      const settings = (await api('POST', '/menu-ordering-settings/v1/menu-ordering-settings/query', { query: {} }))
        .menuOrderingSettings || [];
      for (const s of settings.filter((x) => x.onlineOrderingEnabled === false || x.operationId === 'none')) {
        await api('PATCH', `/menu-ordering-settings/v1/menu-ordering-settings/${s.id}`, { menuOrderingSettings: {
          revision: s.revision, operationId: op.id, onlineOrderingEnabled: true } }).catch(() => {});
      }
      ordering.enabled = true;
      ordering.operationId = op.id;
    }
  }

  // Table reservations: the install creates the location, this sets the party size and opens it online.
  const reservations = { enabled: false };
  if (plan.reservations) {
    const path = '/table-reservations/reservation-locations/v1/reservation-locations';
    await install('f9c07de2-5341-40c6-b096-8eb39de391fb');
    let loc = (await listWhenReady(path, 'reservationLocations'))[0];
    if (loc) {
      reservations.reservationLocationId = loc.id;
      if (plan.reservations.partySize) {
        loc = (await api('PATCH', `${path}/${loc.id}`, { reservationLocation: { id: loc.id, revision: loc.revision,
          configuration: { onlineReservations: { partySize: plan.reservations.partySize } } } })).reservationLocation;
      }
      try {
        await api('PATCH', `${path}/${loc.id}`, { reservationLocation: { id: loc.id, revision: loc.revision,
          configuration: { onlineReservations: { onlineReservationsEnabled: true } } } });
        reservations.enabled = true;
      } catch (e) {
        reservations.premiumRequired = true;          // a site with no paid plan cannot open reservations online
      }
    }
  }

  return { menus, images, failed, ordering, reservations };
}
```

A dish takes `price` or `variants` (sizes, each with a price), `modifierGroups` (choices and
extras, with `required`, `min` and `max` on the group and `price`, `preSelected` and `inStock` on
each modifier), `acceptSpecialRequests`, `inStock`, and a picture as `imageUrl` or as
`imageMediaId`, a file in the site's Media Manager. `ordering` turns on online ordering and
`reservations` table reservations; both need `location`, the address of the business.
`reservations.premiumRequired` in the result means that the site needs a paid plan to take
reservations online.

## Step 5: what the pages import

- The menu: `createMenuStore()` in `/js/wix/menu-store.js`.
- The order cart: `/js/wix/order-store.js`, one for the whole site.
- The table booking: `createReservationStore()` in `/js/wix/reservation-store.js`.
- The read: `fetchMenus()` in `/js/wix/menu.js`.

A name that a module does not export stops the whole page. `static.md` shows how to use each one.

## Step 5: the visitor read

```javascript
async function run() {
  const clientId = '<appId from step 2>';
  const tokenRes = await fetch('https://www.wixapis.com/oauth2/token', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, grantType: 'anonymous' }) });
  const token = (await tokenRes.json()).access_token;
  const res = await fetch('https://www.wixapis.com/restaurants/menus-item/v1/items?onlyVisible=true', {
    headers: { Authorization: token } });
  const data = await res.json();
  return { status: res.status, names: (data.items || []).map((x) => x.name) };
}
```

The check passes when the names are the dishes that step 4 created.
