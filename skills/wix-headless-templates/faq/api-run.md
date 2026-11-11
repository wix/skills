# FAQ: the calls of a build through the Wix tools

For steps 3 to 5 of the cold start (`wix-headless-cold-start/headless-kit.md`): the call that
installs the app and creates the questions, what the pages import, and the visitor read for the
check.

## Steps 3 and 4: install the app and create the questions

One `ExecuteWixAPI` function with `siteId` and `scope: 'site'`. Change only the plan at the top.

```javascript
async function run() {
  const plan = {
    categories: [
      { title: 'Orders', questions: [
        { question: 'How long does delivery take?', answer: 'Two to four working days.', labels: ['Delivery'] },
        { question: 'Can I return an order?', answer: [
          { type: 'paragraph', text: 'Yes, within 30 days:' },
          { type: 'ordered', items: ['Write to us with the order number.', 'Send the parcel back.'] },
          { type: 'quote', text: 'The refund reaches the card you paid with.' }
        ] }
      ] },
      { title: 'Payments', questions: [
        { question: 'Which cards do you take?', answer: [
          { type: 'heading', text: 'Cards' },
          { type: 'bulleted', items: ['Visa', 'Mastercard'] }
        ] }
      ] }
    ]
  };

  const api = async (method, path, body) =>
    (await wix.request({ scope: 'site', method, url: `https://www.wixapis.com${path}`, body })).data;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  const text = (t) => ({ type: 'TEXT', id: '', nodes: [], textData: { text: t || '', decorations: [] } });
  // An answer is a string, or a list of blocks: paragraph, heading, quote, bulleted, ordered.
  const answer = (a, qi) => {
    if (typeof a === 'string') return { plainText: a };
    let n = 0;
    const id = () => `q${qi}-n${n++}`;
    const paragraph = (t) => ({ type: 'PARAGRAPH', id: id(), nodes: [text(t)], paragraphData: {} });
    return { richContent: { nodes: a.map((b) => {
      if (b.type === 'heading') return { type: 'HEADING', id: id(), nodes: [text(b.text)], headingData: { level: b.level || 2 } };
      if (b.type === 'quote') return { type: 'BLOCKQUOTE', id: id(), nodes: [paragraph(b.text)], blockquoteData: { indentation: 1 } };
      if (b.type === 'bulleted' || b.type === 'ordered') {
        return { type: b.type === 'bulleted' ? 'BULLETED_LIST' : 'ORDERED_LIST', id: id(),
          nodes: b.items.map((item) => ({ type: 'LIST_ITEM', id: id(), nodes: [paragraph(item)] })) };
      }
      return paragraph(b.text);
    }) } };
  };

  await api('POST', '/apps-installer-service/v1/app-instance/install',
    { tenant: { tenantType: 'SITE', id: siteId }, appInstance: { appDefId: '14c92d28-031e-7910-c9a8-a670011e062d', enabled: true } });
  await wait(3000);                                             // a new install settles before its first write

  // Categories: reuse one with the same title, create the rest, and read until each one is there.
  const readCategories = async () =>
    (await api('POST', '/faq/v2/categories/query', { query: { cursorPaging: { limit: 100 } } })).categories || [];
  let have = await readCategories();
  for (let attempt = 0; attempt < 8; attempt++) {
    const missing = plan.categories.filter((c) => !have.some((h) => same(h.title, c.title)));
    if (!missing.length) break;
    if (attempt) await wait(1500);
    const top = Math.max(0, ...have.map((h) => h.sortOrder || 0));
    for (const [i, c] of missing.entries()) {
      await api('POST', '/faq/v2/categories', { category: { title: c.title, sortOrder: top + 10 * (i + 1) } });
    }
    have = await readCategories();
  }

  const existing = (await api('POST', '/faq/v2/question-entries/query',
    { query: { cursorPaging: { limit: 100 } } })).questionEntries || [];
  const created = [];
  const failed = [];
  let qi = 0;
  for (const c of plan.categories) {
    const categoryId = have.find((h) => same(h.title, c.title)).id;
    const inCategory = existing.filter((q) => q.categoryId === categoryId);
    let sortOrder = Math.max(0, ...inCategory.map((q) => q.sortOrder || 0));
    for (const q of c.questions) {
      qi++;
      if (inCategory.some((x) => same(x.question, q.question))) continue;
      sortOrder += 10;
      try {
        const made = (await api('POST', '/faq/v2/question-entries', { questionEntry: {
          question: q.question, categoryId, sortOrder,
          ...(q.labels ? { labels: q.labels.map((title, i) => ({ title, sortOrder: i })) } : {}),
          ...answer(q.answer, qi) } })).questionEntry;
        created.push({ id: made.id, category: c.title, question: made.question });
      } catch (e) {
        failed.push({ question: q.question, error: String(e.message).slice(0, 200) });
      }
    }
  }
  return { categories: plan.categories.map((c) => have.find((h) => same(h.title, c.title)).id), created, failed };
}
```

A question's `answer` is a string, or a list of blocks: `paragraph`, `heading`, `quote`, `bulleted`
and `ordered`. A question takes `labels`. A category or a question that the site already has is
used as it is.

## Step 5: what the pages import

- The reads: `fetchFaq()` and `fetchQuestions` in `/js/wix/faq.js`.
- The store of the page, as functions in `/js/wix/faq-store.js`: `seedFaq(options)`,
  `subscribeFaq(fn)`, `getFaqState()`, and the actions `selectCategory`, `setQuery`,
  `toggleQuestion`.

A name that a module does not export stops the whole page. `static.md` shows how to use each one.

## Step 5: the visitor read

```javascript
async function run() {
  const clientId = '<appId from step 2>';
  const tokenRes = await fetch('https://www.wixapis.com/oauth2/token', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, grantType: 'anonymous' }) });
  const token = (await tokenRes.json()).access_token;
  const res = await fetch('https://www.wixapis.com/faq/v2/question-entries/query', { method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { cursorPaging: { limit: 100 } } }) });
  const data = await res.json();
  return { status: res.status, questions: (data.questionEntries || []).map((x) => x.question) };
}
```

A new FAQ app comes with sample questions from Wix. The check passes when the questions that
step 4 created are in the list.
