# Portfolio: the calls of a build through the Wix tools

For steps 4 and 5 of the cold start (`wix-headless-cold-start/headless-kit.md`): the call that
creates the projects, what the pages import, and the visitor read for the check.

## Step 4: create the projects

One `ExecuteWixAPI` function with `siteId` and `scope: 'site'`. Change only the plan at the top.

```javascript
async function run() {
  const plan = {
    collections: [
      { title: 'Weddings', description: 'Two-day weddings by the water.',
        coverImageUrl: 'https://images.unsplash.com/photo-1519741497674-611481863552?w=1600' }
    ],
    projects: [
      { title: 'Lake Como, June', description: 'Two days on the water.', collection: 'Weddings',
        details: [{ label: 'Year', text: '2025' }, { label: 'Role', text: 'Photography' }],
        coverImageUrl: 'https://images.unsplash.com/photo-1511285560929-80b456fea0bc?w=1600',
        items: [
          { title: 'The ceremony', imageUrl: 'https://images.unsplash.com/photo-1465495976277-4387d4b0b4c6?w=1600' },
          { title: 'The dinner', imageUrl: 'https://images.unsplash.com/photo-1519225421980-715cb0215aed?w=1600' }
        ] }
    ]
  };

  const api = async (method, path, body) =>
    (await wix.request({ scope: 'site', method, url: `https://www.wixapis.com${path}`, body })).data;
  const failed = [];
  // A picture is a URL (imageUrl, coverImageUrl) or a file of the site's Media Manager
  // (imageMediaId, coverImageMediaId).
  const picture = async (mediaId, url, name) => {
    if (!mediaId && !url) return null;
    try {
      const id = mediaId || (await api('POST', '/site-media/v1/files/import',
        { url, mimeType: 'image/png', displayName: `${name}.png` })).file.id;
      return { imageInfo: { id, height: 1024, width: 1024 } };
    } catch (e) {
      failed.push({ picture: name, error: String(e.message).slice(0, 200) });
      return null;
    }
  };

  const collectionId = {};
  const collections = [];
  for (const c of plan.collections) {
    const made = (await api('POST', '/portfolio/v1/collections', { collection: {
      title: c.title, description: c.description || '', ...(c.hidden ? { hidden: true } : {}) } })).collection;
    collectionId[c.title] = made.id;
    collections.push({ id: made.id, slug: made.slug });
    const cover = await picture(c.coverImageMediaId, c.coverImageUrl, `${c.title} cover`);
    if (cover) {
      await api('PATCH', `/portfolio/v1/collections/${made.id}`,
        { collection: { id: made.id, revision: made.revision, coverImage: cover } });
    }
  }

  const projects = [];
  for (const p of plan.projects) {
    const made = (await api('POST', '/portfolio/v1/projects', { project: {
      title: p.title, description: p.description || '',
      collectionIds: collectionId[p.collection] ? [collectionId[p.collection]] : [],
      ...(p.details ? { details: p.details } : {}), ...(p.hidden ? { hidden: true } : {}) } })).project;
    let items = 0;
    for (const [n, it] of (p.items || []).entries()) {
      const image = await picture(it.imageMediaId, it.imageUrl, it.title || `${p.title} ${n + 1}`);
      if (!image) continue;
      await api('POST', '/portfolio/v1/items',
        { item: { projectId: made.id, sortOrder: n + 1, title: it.title, image } });
      items++;
    }
    const cover = await picture(p.coverImageMediaId, p.coverImageUrl, `${p.title} cover`);
    if (cover) {
      await api('PATCH', `/portfolio/v1/projects/${made.id}`,
        { project: { id: made.id, revision: made.revision, coverImage: cover } });
    }
    projects.push({ id: made.id, slug: made.slug, items, cover: !!cover });
  }
  return { collections, projects, failed };
}
```

`collections` and `projects` take a `hidden: true`. A project names its collection by title, and takes
`details` rows and gallery `items` in the order shown. A cover is `coverImageUrl` or
`coverImageMediaId`, and an item's picture is `imageUrl` or `imageMediaId`; a media id is a file in
the site's Media Manager.

## Step 5: what the pages import

- The collections: `createCollectionsStore()` in `/js/wix/collections-store.js`.
- One collection and its projects: `createCollectionProjectsStore(slug)` in
  `/js/wix/collection-projects-store.js`.
- One project and its gallery: `createProjectDetailStore(slug)` in `/js/wix/project-detail-store.js`.
- The reads: `fetchCollections`, `fetchProjects` and `fetchProjectBySlug` in `/js/wix/portfolio.js`.

A name that a module does not export stops the whole page. `static.md` shows how to use each one.

## Step 5: the visitor read

```javascript
async function run() {
  const clientId = '<appId from step 2>';
  const tokenRes = await fetch('https://www.wixapis.com/oauth2/token', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, grantType: 'anonymous' }) });
  const token = (await tokenRes.json()).access_token;
  const res = await fetch('https://www.wixapis.com/portfolio/v1/projects?paging.limit=20', {
    headers: { Authorization: token } });
  const data = await res.json();
  return { status: res.status, count: (data.projects || []).length, titles: (data.projects || []).map((x) => x.title) };
}
```

The check passes when the titles are the projects that step 4 created.
