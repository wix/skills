# Store: the calls of a build through the Wix tools

For steps 4 and 5 of the cold start (`wix-headless-cold-start/headless-kit.md`): the call that
creates the products, what the pages import, and the visitor read for the check.

## Step 4: create the products

One `ExecuteWixAPI` function with `siteId` and `scope: 'site'`. Change only the plan at the top.

```javascript
async function run() {
  const plan = {
    products: [
      { name: 'Country Sourdough', price: 9.5, description: 'A slow loaf with a dark crust.\nBaked every morning.',
        quantity: 40, ribbon: 'New',
        imageUrl: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=1200',
        infoSections: [{ title: 'Ingredients', description: 'Flour, water, salt.' }] },
      { name: 'Linen Apron', price: 38, compareAtPrice: 45, description: 'Heavy linen with a cross back.',
        inStock: true,
        options: [
          { name: 'Color', type: 'color', choices: [
            { name: 'Oat', colorCode: '#d8cbb5', imageUrl: 'https://images.unsplash.com/photo-1556911220-bff31c812dba?w=1200' },
            { name: 'Ink', colorCode: '#1f2a44' }] },
          { name: 'Size', choices: ['Regular', 'Long'] }
        ],
        variantPrices: { Long: 42 },
        modifiers: [{ name: 'Embroidered name', type: 'text', mandatory: false, maxChars: 20 }] }
    ],
    categories: {
      Bread: { products: ['Country Sourdough'], description: 'Baked daily.' },
      Kitchen: { products: ['Linen Apron'] }
    }
  };

  const api = async (method, path, body) =>
    (await wix.request({ scope: 'site', method, url: `https://www.wixapis.com${path}`, body })).data;
  const tree = { appNamespace: '@wix/stores', treeKey: null };
  const rich = (text, key) => ({
    nodes: String(text || '').split('\n').map((line, n) => ({ type: 'PARAGRAPH', id: `${key}-${n}`,
      paragraphData: { textStyle: { textAlignment: 'AUTO' } },
      nodes: [{ type: 'TEXT', id: '', nodes: [], textData: { text: line, decorations: [] } }] })),
    metadata: { version: 1, id: `${key}-meta` }
  });
  const choiceName = (c) => (typeof c === 'string' ? c : c.name);
  const renderType = (o) => (o.type === 'color' ? 'SWATCH_CHOICES' : 'TEXT_CHOICES');
  const priceOf = (p, amount) => ({ actualPrice: { amount: String(amount) },
    ...(p.compareAtPrice > amount ? { compareAtPrice: { amount: String(p.compareAtPrice) } } : {}) });
  const variants = (p) => {
    const base = { visible: true, physicalProperties: {}, price: priceOf(p, p.price),
      inventoryItem: p.inStock ? { inStock: true } : { quantity: p.quantity || 0 } };
    let combos = [[]];
    for (const o of p.options || []) {
      combos = combos.flatMap((combo) => o.choices.map((c) =>
        [...combo, { optionChoiceNames: { optionName: o.name, choiceName: choiceName(c), renderType: renderType(o) } }]));
    }
    if (!(p.options || []).length) return [base];
    return combos.map((choices) => {
      const other = choices.map((c) => (p.variantPrices || {})[c.optionChoiceNames.choiceName]).find((v) => v != null);
      return { ...base, choices, ...(other != null ? { price: priceOf(p, other) } : {}) };
    });
  };

  const body = { returnEntity: true, products: plan.products.map((p, i) => ({
    name: p.name, productType: 'PHYSICAL', physicalProperties: {}, visibleInPos: true, visible: true,
    description: rich(p.description, `desc-${i}`),
    options: (p.options || []).map((o) => ({ name: o.name, optionRenderType: renderType(o),
      choicesSettings: { choices: o.choices.map((c) => (o.type === 'color'
        ? { choiceType: 'ONE_COLOR', name: c.name, colorCode: c.colorCode }
        : { choiceType: 'CHOICE_TEXT', name: choiceName(c) })) } })),
    ...(p.ribbon ? { ribbon: { name: p.ribbon } } : {}),
    ...(p.modifiers ? { modifiers: p.modifiers.map((m) => ({ name: m.name, mandatory: m.mandatory !== false,
      ...(m.type === 'text'
        ? { modifierRenderType: 'FREE_TEXT', freeTextSettings: { title: m.title || m.name,
            ...(m.maxChars ? { maxCharCount: m.maxChars } : {}) } }
        : { modifierRenderType: 'TEXT_CHOICES', choicesSettings: { choices: m.choices.map((c) => ({
            choiceType: 'CHOICE_TEXT', name: choiceName(c),
            ...(c.addedPrice != null ? { addedPrice: String(c.addedPrice) } : {}) })) } }) })) } : {}),
    ...(p.infoSections ? { infoSections: p.infoSections.map((s, n) => ({
      uniqueName: s.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title: s.title,
      description: rich(s.description, `info-${i}-${n}`) })) } : {}),
    variantsInfo: { variants: variants(p) }
  })) };
  const created = await api('POST', '/stores/v3/bulk/products-with-inventory/create', body);
  const failed = [];
  const made = [];
  for (const r of created.productResults.results) {
    const p = plan.products[r.itemMetadata.originalIndex];
    if (r.itemMetadata.success && r.item) made.push({ plan: p, id: r.item.id, slug: r.item.slug, item: r.item });
    else failed.push({ name: p.name, error: r.itemMetadata.error });
  }

  // A product with no options gets its stock in a second call.
  const plain = made.filter((m) => !(m.plan.options || []).length);
  if (plain.length) {
    await api('POST', '/stores/v3/bulk/inventory-items/create', { inventoryItems: plain.map((m) => ({
      productId: m.id, variantId: m.item.variantsInfo.variants[0].id,
      ...(m.plan.inStock ? { inStock: true } : { quantity: m.plan.quantity || 0 }) })) });
  }

  // Categories: reuse one with the same name, create the rest, then add the products.
  const names = Object.keys(plan.categories || {});
  if (names.length) {
    const have = await api('POST', '/categories/v1/categories/query',
      { treeReference: tree, query: { cursorPaging: { limit: 100 } } });
    for (const name of names) {
      const c = plan.categories[name];
      let id = (have.categories || []).find((x) => x.name === name)?.id;
      if (!id) {
        id = (await api('POST', '/categories/v1/categories', { treeReference: tree, category: { name, visible: true,
          ...(c.description ? { description: c.description } : {}),
          ...(c.imageUrl ? { image: { url: c.imageUrl } } : {}) } })).category.id;
      }
      const ids = made.filter((m) => c.products.includes(m.plan.name)).map((m) => m.id);
      if (ids.length) {
        await api('POST', `/categories/v1/bulk/categories/${id}/add-items`, { treeReference: tree,
          items: ids.map((catalogItemId) => ({ catalogItemId, appId: '215238eb-22a5-4c36-9e7b-e7c08025e04e' })) });
      }
    }
  }

  // Images: imageUrl or imageMediaId on a product, and on a choice of an option.
  const image = (x, altText) => (x.imageMediaId ? { id: x.imageMediaId, altText } : { url: x.imageUrl, altText });
  const withImages = made.map((m) => {
    const choices = (m.plan.options || []).flatMap((o) => o.choices
      .filter((c) => c.imageUrl || c.imageMediaId).map((c) => ({ option: o.name, choice: c.name, src: c })));
    const items = [
      ...(m.plan.imageUrl || m.plan.imageMediaId ? [image(m.plan, m.plan.name)] : []),
      ...choices.map((c) => image(c.src, `${m.plan.name}, ${c.choice}`))
    ];
    return { ...m, choices, items };
  }).filter((m) => m.items.length);
  if (withImages.length) {
    const updated = await api('POST', '/stores/v3/bulk/products/update', { returnEntity: true,
      products: withImages.map((m) => ({ product: { id: m.id, revision: m.item.revision,
        media: { itemsInfo: { items: m.items } } } })) });
    for (const r of updated.results) {
      if (!r.itemMetadata.success) failed.push({ name: withImages[r.itemMetadata.originalIndex].plan.name, error: r.itemMetadata.error });
    }
  }
  // A choice shows its own image once the product's gallery holds it.
  for (const m of withImages.filter((x) => x.choices.length)) {
    const first = m.plan.imageUrl || m.plan.imageMediaId ? 1 : 0;
    let p;
    let gallery = [];
    for (let i = 0; i < 8; i++) {
      p = (await api('GET', `/stores/v3/products/${m.id}?fields=MEDIA_ITEMS_INFO&fields=VARIANT_OPTION_CHOICE_NAMES`)).product;
      gallery = p.media?.itemsInfo?.items || [];
      if (gallery.length >= m.items.length && gallery.every((g) => g.id)) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    await api('PATCH', `/stores/v3/products/${m.id}`, { product: { id: m.id, revision: p.revision,
      options: p.options.map((o) => ({ id: o.id, name: o.name, optionRenderType: o.optionRenderType,
        choicesSettings: { choices: o.choicesSettings.choices.map((c) => {
          const n = m.choices.findIndex((x) => x.option === o.name && x.choice === c.name);
          const mediaId = n >= 0 ? gallery[first + n]?.id : null;
          return { choiceId: c.choiceId, name: c.name, choiceType: c.choiceType,
            ...(c.colorCode ? { colorCode: c.colorCode } : {}),
            ...(mediaId ? { media: { items: [{ mediaId }] } } : {}) };
        }) } })),
      variantsInfo: { variants: p.variantsInfo.variants.map((v) => ({ id: v.id, choices: v.choices, visible: true,
        physicalProperties: {}, price: { actualPrice: { amount: v.price.actualPrice.amount },
          ...(v.price.compareAtPrice?.amount ? { compareAtPrice: { amount: v.price.compareAtPrice.amount } } : {}) } })) } } });
  }

  return { products: made.map((m) => ({ id: m.id, name: m.plan.name, slug: m.slug })), categories: names, failed };
}
```

A product takes a description, `quantity` or `inStock`, `compareAtPrice`, a `ribbon`, options
(text, or `type: 'color'` with a `colorCode` for each choice), `variantPrices` by choice name,
modifiers, info sections and an image (`imageUrl`, or `imageMediaId` for a file in the site's
Media Manager). A choice of an option takes an image the same way. A category takes its
products by name, a description and an `imageUrl`. Digital products are in
`seed/seed-storefront.mjs`.

## Step 5: what the pages import

- The list of products: `createShopStore` in `/js/wix/shop-store.js`.
- One product: `createProductDetailStore` in `/js/wix/product-detail-store.js`.
- The cart: `/js/wix/cart-store.js`, one for the whole site.
- The reads: `fetchProducts` and `fetchProductBySlug` in `/js/wix/catalog.js`.

A name that a module does not export stops the whole page. `static.md` shows how to use each one.

## Step 5: the visitor read

```javascript
async function run() {
  const clientId = '<appId from step 2>';
  const tokenRes = await fetch('https://www.wixapis.com/oauth2/token', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, grantType: 'anonymous' }) });
  const token = (await tokenRes.json()).access_token;
  const res = await fetch('https://www.wixapis.com/stores/v3/products/search', { method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ search: { cursorPaging: { limit: 20 } } }) });
  const data = await res.json();
  return { status: res.status, count: (data.products || []).length, names: (data.products || []).map((p) => p.name) };
}
```

The check passes when the names are the products that step 4 created.
