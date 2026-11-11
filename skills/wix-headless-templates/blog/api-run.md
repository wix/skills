# Blog: the calls of a build through the Wix tools

For steps 4 and 5 of the cold start (`wix-headless-cold-start/headless-kit.md`): the call that
creates the posts, what the pages import, and the visitor read for the check.

## Step 4: create the posts

One `ExecuteWixAPI` function with `siteId` and `scope: 'site'`. Change only the plan at the top.

```javascript
async function run() {
  const plan = {
    posts: [
      { title: 'How We Roast Our Single-Origin Beans', category: 'Stories', tags: ['coffee'],
        coverImageUrl: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=1200&q=80',
        content: [
          { type: 'heading', text: 'From farm to cup', level: 2 },
          { type: 'paragraph', text: 'Every batch starts with beans sourced from a single estate.' },
          { type: 'quote', text: 'Great coffee is grown, not made.' }
        ] },
      { title: 'The Pour-Over, Step by Step', category: 'Brewing', tags: ['guides'],
        content: [
          { type: 'paragraph', text: 'A repeatable ritual in five minutes.' },
          { type: 'ordered', items: ['Rinse the filter', 'Bloom 30 seconds', 'Pour in circles'] }
        ] }
    ]
  };
  const api = (method, path, body) => wix.request({ scope: 'site', method, url: 'https://www.wixapis.com' + path, body });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // the author of every post: a member of the site
  const memberId = (await api('GET', '/members/v1/members?fieldsets=PUBLIC&paging.limit=1')).data.members[0].id;

  // categories and tags, by name: create the missing ones, read until they are all there
  async function labels(kind, names, createPath, body) {
    let map = new Map();
    for (let attempt = 0; attempt < 8; attempt++) {
      const q = await api('POST', `/blog/v3/${kind}/query`, { query: { paging: { limit: 100 } } });
      map = new Map((q.data[kind] || []).map((x) => [x.label, x.id]));
      const missing = names.filter((n) => !map.has(n));
      if (!missing.length) break;
      if (attempt) await sleep(1500);
      for (const name of missing) {
        try { await api('POST', createPath, body(name)); } catch (e) { if (!String(e.message).includes('409')) throw e; }
      }
    }
    return map;
  }
  const catNames = [...new Set(plan.posts.map((p) => p.category).filter(Boolean))];
  const tagNames = [...new Set(plan.posts.flatMap((p) => p.tags || []))];
  const catId = catNames.length ? await labels('categories', catNames, '/blog/v3/categories', (label) => ({ category: { label } })) : new Map();
  const tagId = tagNames.length ? await labels('tags', tagNames, '/blog/v3/tags', (label) => ({ label })) : new Map();

  // the body of a post, from its blocks
  const text = (t) => ({ type: 'TEXT', id: '', nodes: [], textData: { text: t || '', decorations: [] } });
  const para = (id, t) => ({ type: 'PARAGRAPH', id, nodes: [text(t)], paragraphData: {} });
  function richContent(blocks, pi) {
    let n = 0;
    const id = () => `p${pi}-n${n++}`;
    return { nodes: (blocks || []).map((b) => {
      if (b.type === 'heading') return { type: 'HEADING', id: id(), nodes: [text(b.text)], headingData: { level: b.level || 2 } };
      if (b.type === 'quote') return { type: 'BLOCKQUOTE', id: id(), nodes: [para(id(), b.text)], blockquoteData: { indentation: 1 } };
      if (b.type === 'bulleted' || b.type === 'ordered') return { type: b.type === 'bulleted' ? 'BULLETED_LIST' : 'ORDERED_LIST', id: id(),
        nodes: (b.items || []).map((item) => ({ type: 'LIST_ITEM', id: id(), nodes: [para(id(), item)] })) };
      return para(id(), b.text);
    }) };
  }
  const draftPosts = plan.posts.map((p, i) => ({
    title: p.title, memberId, richContent: richContent(p.content, i),
    ...(p.category && catId.get(p.category) ? { categoryIds: [catId.get(p.category)] } : {}),
    ...((p.tags || []).length ? { tagIds: p.tags.map((t) => tagId.get(t)).filter(Boolean) } : {})
  }));

  // one post goes to the single endpoint, two or more to the bulk endpoint; both publish
  let created;
  if (draftPosts.length === 1) {
    const r = await api('POST', '/blog/v3/draft-posts', { draftPost: draftPosts[0], publish: true });
    created = [{ id: r.data.draftPost.id, success: true }];
  } else {
    const r = await api('POST', '/blog/v3/bulk/draft-posts/create', { draftPosts, publish: true });
    created = r.data.results.map((x) => ({ id: x.itemMetadata.id, index: x.itemMetadata.originalIndex, success: x.itemMetadata.success }));
  }

  // covers: a file already in the Media Manager (coverImageMediaId), or an image at a URL (coverImageUrl)
  let covers = 0;
  for (const [i, p] of plan.posts.entries()) {
    const c = created.find((x) => (x.index ?? 0) === i) || created[i];
    if (!c || !c.success || !(p.coverImageMediaId || p.coverImageUrl)) continue;
    try {
      const fileId = p.coverImageMediaId || (await api('POST', '/site-media/v1/files/import',
        { url: p.coverImageUrl, mimeType: 'image/png', displayName: `post-${i}.png` })).data.file.id;
      await api('PATCH', `/blog/v3/draft-posts/${c.id}`, { draftPost: { media: { displayed: true, custom: true, wixMedia: { image: { id: fileId } } } } });
      await api('POST', `/blog/v3/draft-posts/${c.id}/publish`);
      covers++;
    } catch (e) { c.coverError = String(e.message).slice(0, 200); }
  }
  return { posts: created, categories: [...catId.keys()], tags: [...tagId.keys()], covers };
}
```

The posts are published. A post takes a category, tags, a cover (`coverImageUrl`, or
`coverImageMediaId` for a file in the site's Media Manager) and content blocks: `heading`,
`paragraph`, `quote`, `bulleted` and `ordered`.

## Step 5: what the pages import

- The list of posts: `createBlogFeedStore()` in `/js/wix/blog-feed-store.js`.
- One post: `createPostStore({ slug })` in `/js/wix/post-store.js`.
- The reads: `fetchPosts` and `fetchPostBySlug` in `/js/wix/posts.js`.

A name that a module does not export stops the whole page. `static.md` shows how to use each one.

## Step 5: the visitor read

```javascript
async function run() {
  const clientId = '<appId from step 2>';
  const tokenRes = await fetch('https://www.wixapis.com/oauth2/token', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, grantType: 'anonymous' }) });
  const token = (await tokenRes.json()).access_token;
  const res = await fetch('https://www.wixapis.com/blog/v3/posts/query', { method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { cursorPaging: { limit: 20 } } }) });
  const data = await res.json();
  return { status: res.status, count: (data.posts || []).length, titles: (data.posts || []).map((p) => p.title) };
}
```

The check passes when the titles are the posts that step 4 created.
