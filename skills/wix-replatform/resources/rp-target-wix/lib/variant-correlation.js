'use strict';

// Shared deterministic one-to-one comparison; response order is never an identity.
function resolveInventoryRows(canonical, target) {
  if (!target || !target.id || !Array.isArray(target.variantsInfo?.variants)) throw new Error('Target product omitted variant identities');
  // Stores V3 may re-case option and choice names on write ("ALTERNATIV" reads back
  // "Alternativ", "10m" reads back "10M"; LIVE-VERIFIED 2026-10-15), so names match
  // case-insensitively. A case-only collision still fails below as an ambiguous match.
  const key = (choices) => JSON.stringify(choices.map(c => [String(c.optionName).toLowerCase(), String(c.choiceName).toLowerCase()]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  const targetByChoices = new Map();
  for (const variant of target.variantsInfo.variants) {
    if (!variant.id) throw new Error('Target variant omitted identity');
    const choices = (variant.choices || []).map(c => {
      if (c.optionChoiceNames) return c.optionChoiceNames;
      const options = (target.options || []).filter(o => o.id === c.optionChoiceIds?.optionId);
      if (options.length !== 1) throw new Error('Target option identity is missing or ambiguous');
      const values = (options[0].choicesSettings?.choices || []).filter(v => v.choiceId === c.optionChoiceIds.choiceId);
      if (values.length !== 1) throw new Error('Target choice identity is missing or ambiguous');
      return { optionName: options[0].name, choiceName: values[0].name };
    });
    const identity = key(choices);
    if (targetByChoices.has(identity)) throw new Error('Ambiguous target variant choices');
    targetByChoices.set(identity, variant.id);
  }
  const matched = new Set();
  return canonical.variants.map(variant => {
    const variantId = targetByChoices.get(key(variant.choices));
    if (!variantId || matched.has(variantId)) throw new Error('Source variant has no unique target match');
    matched.add(variantId);
    return { productId: target.id, variantId, inventory: { inStock: variant.inStock } };
  });
}

module.exports = { resolveInventoryRows };
