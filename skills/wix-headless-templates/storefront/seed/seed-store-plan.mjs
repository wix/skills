// The plan's shapes → the request bodies seed-store.mjs sends (see SEED.md for the plan): the
// description string → Ricos nodes, options → variants (the full Cartesian product), modifiers,
// info sections, pre-order, and the validation that rejects a plan before anything is created.
// Pure functions, no network: seed-store.mjs imports them and makes the calls.

// ---- description string -> Wix rich-text nodes --------------------------------------------------
// Descriptions arrive as HTML as often as not. The writable field is `description` (Ricos
// nodes) — the HTML `plainDescription` the storefront renders is derived from them, so markup
// dropped into a TEXT node comes back escaped and the PDP shows literal tags. Convert the tags
// a model actually emits; a tag-free string stays one paragraph.

const HTML_ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

export function decodeEntities(s) {
  return s.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (m) => HTML_ENTITIES[m] ?? m);
}

export function mkTextNodes(html) {
  const nodes = [];
  let bold = 0, italic = 0, last = 0, m;
  const tag = /<(\/?)(strong|b|em|i)\s*\/?>/gi;
  const push = (raw) => {
    const text = decodeEntities(raw.replace(/<[^>]*>/g, ""));
    if (!text) return;
    const decorations = [];
    if (bold > 0) decorations.push({ type: "BOLD" });
    if (italic > 0) decorations.push({ type: "ITALIC" });
    nodes.push({ type: "TEXT", textData: { text, decorations } });
  };
  while ((m = tag.exec(html)) !== null) {
    push(html.slice(last, m.index));
    const step = m[1] ? -1 : 1;
    if (/^(strong|b)$/i.test(m[2])) bold = Math.max(0, bold + step);
    else italic = Math.max(0, italic + step);
    last = tag.lastIndex;
  }
  push(html.slice(last));
  return nodes.length ? nodes : [{ type: "TEXT", textData: { text: "", decorations: [] } }];
}

export function mkDesc(text, i) {
  const blocks = String(text ?? "").split(/<\/p\s*>|<br\s*\/?>/i).map((b) => b.trim()).filter(Boolean);
  return {
    nodes: (blocks.length ? blocks : [""]).map((block, n) => ({
      type: "PARAGRAPH", id: `desc-${i}-${n}`,
      nodes: mkTextNodes(block),
      paragraphData: { textStyle: { textAlignment: "AUTO" } },
    })),
    metadata: { version: 1, id: `desc-meta-${i}` },
  };
}

// ---- options / variants -------------------------------------------------------------------------

export function buildOptions(options = []) {
  return options.map((o) => {
    const color = o.type === "color";
    return {
      name: o.name,
      optionRenderType: color ? "SWATCH_CHOICES" : "TEXT_CHOICES",
      choicesSettings: {
        choices: o.choices.map((c) =>
          color
            ? { choiceType: "ONE_COLOR", name: c.name, colorCode: c.colorCode }
            : { choiceType: "CHOICE_TEXT", name: typeof c === "string" ? c : c.name }),
      },
    };
  });
}

// Modifiers collect buyer input WITHOUT creating variants (gift wrap, engraving) — defined inline
// like options, each becomes a customization. `type: "text"` → FREE_TEXT with the merchant's
// character limits; anything else → TEXT_CHOICES. `mandatory` defaults to TRUE, which is how the
// storefront reads an omitted flag.
export function buildModifiers(modifiers = []) {
  return modifiers.map((m) => {
    const text = m.type === "text";
    return {
      name: m.name,
      mandatory: m.mandatory !== false,
      ...(text
        ? {
            modifierRenderType: "FREE_TEXT",
            freeTextSettings: {
              title: m.title ?? m.name,
              ...(m.maxChars ? { maxCharCount: m.maxChars } : {}),
              ...(m.minChars ? { minCharCount: m.minChars } : {}),
            },
          }
        : {
            modifierRenderType: "TEXT_CHOICES",
            choicesSettings: {
              choices: (m.choices ?? []).map((c) => ({
                choiceType: "CHOICE_TEXT",
                name: typeof c === "string" ? c : c.name,
                ...(typeof c === "object" && c.addedPrice != null ? { addedPrice: String(c.addedPrice) } : {}),
              })),
            },
          }),
    };
  });
}

// Info sections (materials, shipping, care) — inline definitions; the same title on two products
// shares one section (uniqueName is derived from the title).
export function buildInfoSections(sections = [], i) {
  return sections.map((s, n) => ({
    uniqueName: String(s.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100) || `section-${n}`,
    title: s.title,
    description: mkDesc(s.description, `info-${i}-${n}`),
  }));
}

// Pre-order needs counted stock: `preorderInfo` on the inventory item, enabled with the merchant's
// message and the number of units buyers may pre-order once stock hits zero.
export function preorderInfo(preorder) {
  if (!preorder) return { enabled: false };
  return {
    enabled: true,
    ...(preorder.message ? { message: preorder.message } : {}),
    ...(Number.isInteger(preorder.limit) ? { limit: preorder.limit } : {}),
  };
}

// Full Cartesian product, each variant priced/stocked from the product; visible:true baked in.
// `variantPrices` prices a variant by one of its choice names ("Large": 32) — the first choice
// with a price wins; the product's compareAtPrice is kept only when it stays above that price.
export function expandVariants(options = [], { price, compareAtPrice, quantity, inStock, preorder, variantPrices = {} }, digitalFileId) {
  const priceOf = (amount) => ({
    actualPrice: { amount: String(amount) },
    ...(compareAtPrice && Number(compareAtPrice) > Number(amount) ? { compareAtPrice: { amount: String(compareAtPrice) } } : {}),
  });
  const base = {
    price: priceOf(price),
    visible: true,
    ...(digitalFileId
      ? { digitalProperties: { digitalFile: { id: digitalFileId } }, inventoryItem: { inStock: true } }
      // inStock:true == untracked stock — always buyable, no count. Otherwise track a quantity.
      : { physicalProperties: {}, inventoryItem: inStock === true
          ? { inStock: true }
          : { quantity: quantity ?? 0, preorderInfo: preorderInfo(preorder) } }),
  };
  if (!options.length) return [base];
  let combos = [[]];
  for (const o of options) {
    const rt = o.type === "color" ? "SWATCH_CHOICES" : "TEXT_CHOICES";
    const names = o.choices.map((c) => (typeof c === "string" ? c : c.name));
    combos = combos.flatMap((combo) =>
      names.map((choiceName) => [...combo, { optionChoiceNames: { optionName: o.name, choiceName, renderType: rt } }]));
  }
  return combos.map((choices) => {
    const override = choices.map((c) => variantPrices[c.optionChoiceNames.choiceName]).find((v) => v != null);
    return { ...base, choices, ...(override != null ? { price: priceOf(override) } : {}) };
  });
}

// Reject plans the API would reject halfway through, while nothing has been created yet —
// a mid-batch 400 leaves a half-seeded store that the agent then has to reason about.
export function validateProducts(products) {
  const problems = [];
  const colorByName = new Map();
  products.forEach((p, i) => {
    const where = p.name ? `"${p.name}"` : `product #${i + 1}`;
    if (!p.name) problems.push(`${where}: name is required`);
    if (p.quantity != null && (!Number.isInteger(p.quantity) || p.quantity < 0)) {
      problems.push(`${where}: quantity must be a non-negative integer (got ${p.quantity}) — omit it and set inStock:true for untracked stock`);
    }
    if (p.preorder && (p.inStock === true || p.digitalFilePath || p.digitalFileUrl)) {
      problems.push(`${where}: preorder needs counted stock (a quantity) on a physical product`);
    }
    if (p.preorder?.limit != null && (!Number.isInteger(p.preorder.limit) || p.preorder.limit < 1)) {
      problems.push(`${where}: preorder.limit must be a positive integer`);
    }
    for (const m of p.modifiers ?? []) {
      if (!m?.name) problems.push(`${where}: every modifier needs a name`);
      else if (m.type !== "text" && !(m.choices?.length > 0)) problems.push(`${where}: modifier "${m.name}" needs choices (or type: "text")`);
    }
    for (const s of p.infoSections ?? []) if (!s?.title) problems.push(`${where}: every info section needs a title`);
    const choiceNames = new Set((p.options ?? []).flatMap((o) => (o.choices ?? []).map((c) => (typeof c === "string" ? c : c?.name))));
    for (const [choice, amount] of Object.entries(p.variantPrices ?? {})) {
      if (!choiceNames.has(choice)) problems.push(`${where}: variantPrices names "${choice}", which is not a choice of its options`);
      if (!(Number(amount) >= 0)) problems.push(`${where}: variantPrices["${choice}"] must be a non-negative number`);
    }
    for (const opt of p.options ?? []) {
      const seen = new Set();
      for (const c of opt.choices ?? []) {
        const key = typeof c === "string" ? c : c?.name;
        if (seen.has(key)) problems.push(`${where}: option "${opt.name}" repeats the choice "${key}"`);
        seen.add(key);
        // Wix keys a color choice by name, so the same name with two codes collides.
        const code = typeof c === "object" ? c?.colorCode : undefined;
        if (code) {
          const prev = colorByName.get(key);
          if (prev && prev !== code) problems.push(`color "${key}" is ${prev} on one product and ${code} on another — pick one`);
          colorByName.set(key, code);
        }
      }
    }
  });
  if (problems.length) throw new Error(`invalid seed plan:\n  - ${problems.join("\n  - ")}`);
}
