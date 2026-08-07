// useProductDetail — all PDP logic, no markup: load product by slug, pre-select first in-stock
// choice per option, resolve the buyer's selections to a Wix variant, gate add-to-cart on stock +
// mandatory modifiers, and build the addToCart payload. The data paths here (variant resolution,
// modifier keys, stock gating) are the bug-prone part — keep them verbatim; the PDP page only
// renders what this returns.
import { useState, useEffect, useMemo } from "react";
import { getProductBySlug } from "@/rest/wix-store-catalog";
import { useCart } from "@/context/CartContext";

export function useProductDetail(slug) {
  const { addToCart } = useCart();
  const [product, setProduct] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [selectedOptions, setSelectedOptions] = useState({});
  const [modifierValues, setModifierValues] = useState({});
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    getProductBySlug(slug).then((p) => {
      if (!p) return setNotFound(true);
      setProduct(p);
      const initial = {};
      (p.options || []).forEach((o) => {
        const first = o.choicesSettings?.choices?.find((c) => c.inStock !== false);
        if (first) initial[o.id] = first.choiceId;
      });
      setSelectedOptions(initial);
    });
  }, [slug]);

  const options = product?.options || [];
  const modifiers = product?.modifiers || [];
  const variants = product?.variantsInfo?.variants || [];

  const variant = useMemo(() => {
    if (options.length === 0) return variants[0] || null;
    if (!options.every((o) => selectedOptions[o.id])) return null;
    return variants.find((v) => (v.choices || []).every((c) =>
      selectedOptions[c.optionChoiceIds?.optionId] === c.optionChoiceIds?.choiceId)) || null;
  }, [options, variants, selectedOptions]);

  const inStock = variant ? variant.inventoryStatus?.inStock !== false : true;
  const canAdd = useMemo(() => {
    if (options.length > 0 && !variant) return false;
    if (variant && !inStock) return false;
    return modifiers.filter((m) => m.mandatory).every((m) =>
      m.modifierRenderType === "FREE_TEXT" ? !!modifierValues[m.freeTextSettings?.key] : !!modifierValues[m.key]);
  }, [options, variant, inStock, modifiers, modifierValues]);

  const price = variant?.price?.actualPrice?.formattedAmount || product?.actualPriceRange?.minValue?.formattedAmount || "";

  const selectOption = (optionId, choiceId) => setSelectedOptions((s) => ({ ...s, [optionId]: choiceId }));
  const setModifier = (key, value) => setModifierValues((s) => ({ ...s, [key]: value }));

  async function submit() {
    const modifierChoices = {}, customTextFields = {};
    modifiers.forEach((m) => {
      const k = m.modifierRenderType === "FREE_TEXT" ? m.freeTextSettings?.key : m.key;
      if (!k || !modifierValues[k]) return;
      (m.modifierRenderType === "FREE_TEXT" ? customTextFields : modifierChoices)[k] = modifierValues[k];
    });
    await addToCart(product.id, variant?.id, quantity, {
      modifierChoices: Object.keys(modifierChoices).length ? modifierChoices : undefined,
      customTextFields: Object.keys(customTextFields).length ? customTextFields : undefined,
    });
  }

  return {
    product, notFound, options, modifiers,
    selectedOptions, selectOption, modifierValues, setModifier,
    quantity, setQuantity, variant, inStock, canAdd, price, submit,
  };
}
