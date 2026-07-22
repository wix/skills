# Stores — Get Product

## Get a single product

```typescript
if (v === 'V3_CATALOG') {
  const product = await productsV3.getProduct(id);  // returns Product directly
  return product;
}
const { product } = await products.getProduct(id);  // V1 wraps in { product }
return product;
```

---

## Read product options and choices (V1 vs V3)

V1 and V3 differ in **both where choices live and what the choice fields are named**. Getting this wrong causes `TS2339` at validate time.

| | V1 | V3 |
|---|---|---|
| Options array on product | `product.productOptions` | `product.options` |
| Option name | `option.name` | `option.name` |
| Option type | `option.optionType` (`"color"` / `"drop_down"`) | `option.optionRenderType` (`"SWATCH_CHOICES"` / `"TEXT_CHOICES"`) |
| **Choices array** | `option.choices` ← **directly on the option** | `option.choicesSettings?.choices` ← **nested** |
| Choice display value | `choice.value` | `choice.name` |
| Choice color | `choice.value` (hex string) | `choice.colorCode` |

```typescript
if (v === 'V3_CATALOG') {
  const product = await productsV3.getProduct(id);
  for (const option of product.options ?? []) {
    const choices = option.choicesSettings?.choices ?? [];  // ✅ nested — NOT option.choices / option.optionValues (TS2339)
    for (const choice of choices) {
      render(option.name, choice.name, choice.colorCode);   // name = label; colorCode = hex for SWATCH_CHOICES
    }
  }
} else {
  const { product } = await products.getProduct(id);
  for (const option of product.productOptions ?? []) {
    for (const choice of option.choices ?? []) {           // ✅ direct in V1
      render(option.name, choice.value);                   // value = label or hex string
    }
  }
}
```

**In a site plugin on a product page**: get `productId` from `widget.getProp('product-id')`, then call the appropriate version's `getProduct` — same pattern as above.

---

## Modifiers (V1 `manageVariants=false` options)

In V3, options that **don't** create variants (V1 `manageVariants=false`) live on `product.modifiers`, not `product.options`. They use the identical `choicesSettings.choices` pattern. Reading only `product.options` silently misses these.

```typescript
if (v === 'V3_CATALOG') {
  const product = await productsV3.getProduct(id);
  // variant-creating options
  for (const option of product.options ?? []) {
    for (const choice of option.choicesSettings?.choices ?? []) {
      render(option.name, choice.name, choice.colorCode);
    }
  }
  // display-only / free-text customizations (formerly manageVariants=false)
  for (const modifier of product.modifiers ?? []) {
    for (const choice of modifier.choicesSettings?.choices ?? []) {
      render(modifier.name, choice.name, choice.colorCode);
    }
  }
}
```

---

## Variant choices (V1 object map → V3 array)

V1 `variant.choices` was a plain object map `{ "Size": "Small" }`. V3 restructures it as an array — accessing it with a key returns `undefined` silently.

```typescript
if (v === 'V3_CATALOG') {
  const product = await productsV3.getProduct(id);
  // variants are NOT returned by queryProducts — use getProduct or Read-Only Variants API
  for (const variant of product.variantsInfo?.variants ?? []) {
    for (const c of variant.choices ?? []) {
      render(c.optionChoiceNames?.optionName, c.optionChoiceNames?.choiceName);
    }
    // ❌ variant.choices['Size'] — always undefined in V3 (object map is gone)
  }
} else {
  const { product } = await products.getProduct(id);
  for (const variant of product.variants ?? []) {
    // V1: choices is { [optionName]: value }
    render(Object.entries(variant.choices ?? {}).map(([k, v]) => `${k}:${v}`).join(', '));
  }
}
```
