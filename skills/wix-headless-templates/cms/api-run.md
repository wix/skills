# CMS: the calls of a build through the Wix tools

For steps 3 to 5 of the cold start (`wix-headless-cold-start/headless-kit.md`): the call that
installs the app and creates the collection and its items, what the pages import, and the visitor read for the
check.

## Steps 3 and 4: install the app and create the collection and its items

One `ExecuteWixAPI` function with `siteId` and `scope: 'site'`. Change only the plan at the top.

```javascript
async function run() {
  const plan = {
    collections: [
      { id: 'Categories', fields: [{ key: 'name', type: 'TEXT' }],
        items: [{ name: 'Soups' }, { name: 'Breads' }] },
      { id: 'Authors', fields: [{ key: 'name', type: 'TEXT' }, { key: 'email', type: 'EMAIL' }],
        items: [{ name: 'Dana Levi', email: 'dana@example.com' }] },
      { id: 'Recipes',
        fields: [
          { key: 'title', type: 'TEXT' },
          { key: 'slug', type: 'TEXT' },
          { key: 'body', type: 'RICH_TEXT' },
          { key: 'minutes', type: 'NUMBER' },
          { key: 'vegan', type: 'BOOLEAN' },
          { key: 'tags', type: 'ARRAY_STRING' },
          { key: 'publishDate', type: 'DATE' },
          { key: 'photo', type: 'IMAGE' },
          { key: 'author', type: 'REFERENCE', referencedCollectionId: 'Authors' },
          { key: 'categories', type: 'MULTI_REFERENCE', referencedCollectionId: 'Categories' }
        ],
        items: [
          { title: 'Lentil Soup', slug: 'lentil-soup', body: '<p>Soften the onion, then add the lentils.</p>',
            minutes: 40, vegan: true, tags: ['winter', 'one pot'], publishDate: '2026-08-01',
            photo: 'https://images.unsplash.com/photo-1547592166-23ac45744acd?w=1600',
            author: 0, categories: [0] }
        ] }
    ]
  };

  const api = async (method, path, body) =>
    (await wix.request({ scope: 'site', method, url: `https://www.wixapis.com${path}`, body })).data;
  await api('POST', '/apps-installer-service/v1/app-instance/install',
    { tenant: { tenantType: 'SITE', id: siteId }, appInstance: { appDefId: 'e593b0bd-b783-45b8-97c2-873d42aacaf4', enabled: true } });

  // A collection that another one refers to comes before it in the plan. A REFERENCE value is the
  // place of the item in that collection's items; a MULTI_REFERENCE value is a list of places.
  const ids = {};
  const out = [];
  for (const col of plan.collections) {
    const fieldOf = Object.fromEntries(col.fields.map((f) => [f.key, f]));
    let created = true;
    try {
      await api('POST', '/wix-data/v2/collections', { collection: {
        id: col.id, displayName: col.displayName || col.id,
        fields: col.fields.map((f) => ({ key: f.key, displayName: f.displayName || f.key, type: f.type,
          ...(f.type === 'REFERENCE' ? { typeMetadata: { reference: { referencedCollectionId: f.referencedCollectionId } } } : {}),
          ...(f.type === 'MULTI_REFERENCE' ? { typeMetadata: { multiReference: {
            referencedCollectionId: f.referencedCollectionId,
            referencingFieldKey: `${col.id}_${f.key}`, referencingDisplayName: `${col.id} (${f.key})` } } } : {}) })),
        permissions: { insert: 'ADMIN', update: 'ADMIN', remove: 'ADMIN', read: 'ANYONE' }
      } });
    } catch (e) {
      if (!String(e.message).includes('WDE0104')) throw e;        // the collection is already there
      created = false;
    }

    const links = [];
    const failed = [];
    const dataItems = [];
    for (const [i, item] of (col.items || []).entries()) {
      const data = {};
      for (const [key, value] of Object.entries(item)) {
        const type = fieldOf[key].type;
        if (type === 'MULTI_REFERENCE') {
          for (const place of value) links.push({ i, key, target: ids[fieldOf[key].referencedCollectionId][place] });
        } else if (type === 'REFERENCE') {
          data[key] = ids[fieldOf[key].referencedCollectionId][value];
        } else if (type === 'IMAGE') {
          // A picture is a URL, or { mediaId } for a file of the site's Media Manager.
          try {
            data[key] = value.mediaId
              ? `https://static.wixstatic.com/media/${value.mediaId}`
              : (await api('POST', '/site-media/v1/files/import',
                { url: value, mimeType: 'image/png', displayName: `${col.id}-${i}-${key}.png` })).file.url;
          } catch (e) {
            failed.push({ item: i, field: key, error: String(e.message).slice(0, 200) });
          }
        } else if (type === 'DATE' || type === 'DATETIME') {
          data[key] = { $date: new Date(value).toISOString() };
        } else {
          data[key] = value;
        }
      }
      dataItems.push({ data });
    }

    ids[col.id] = [];
    let failures = 0;
    if (dataItems.length) {
      const inserted = await api('POST', '/wix-data/v2/bulk/items/insert',
        { dataCollectionId: col.id, dataItems, returnEntity: true });
      for (const r of inserted.results || []) ids[col.id][r.itemMetadata.originalIndex] = r.dataItem?.id || r.itemMetadata.id;
      failures = inserted.bulkActionMetadata.totalFailures;
    }
    if (links.length) {
      await api('POST', '/wix-data/v2/bulk/items/insert-references', { dataCollectionId: col.id,
        dataItemReferences: links.map((l) => ({ referringItemFieldName: l.key,
          referringItemId: ids[col.id][l.i], referencedItemId: l.target })) });
    }
    out.push({ id: col.id, created, inserted: ids[col.id].filter(Boolean).length, failures, references: links.length, failed });
  }
  return out;
}
```

Anyone can read the collections, and only the owner can change them. A field's `type` is `TEXT`,
`NUMBER`, `BOOLEAN`, `DATE`, `DATETIME`, `TIME`, `URL`, `EMAIL`, `IMAGE`, `RICH_TEXT` (an HTML
string), `ARRAY_STRING`, `REFERENCE` or `MULTI_REFERENCE`. An `IMAGE` value is a URL, or
`{ mediaId }` for a file in the site's Media Manager. A collection with a detail page has a `slug`
field.

## Step 5: what the pages import

- A list of items: `createCollectionStore(options)` in `/js/wix/collection-store.js`.
- One item: `createItemStore(options)` in `/js/wix/item-store.js`.
- The reads: `queryItems(collectionId, options)` and `getItemBy(collectionId, field, value)` in
  `/js/wix/items.js`.

A name that a module does not export stops the whole page. `static.md` shows how to use each one.

## Step 5: the visitor read

```javascript
async function run() {
  const clientId = '<appId from step 2>';
  const tokenRes = await fetch('https://www.wixapis.com/oauth2/token', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, grantType: 'anonymous' }) });
  const token = (await tokenRes.json()).access_token;
  const res = await fetch('https://www.wixapis.com/wix-data/v2/items/query', { method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataCollectionId: 'Recipes', query: { paging: { limit: 20, offset: 0 } } }) });
  const data = await res.json();
  return { status: res.status, items: (data.dataItems || []).map((x) => x.data) };
}
```

The check passes when the items are the ones that step 4 created.
