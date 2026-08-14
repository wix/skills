// useProductDetail — all PDP logic, no markup: load product by slug, pre-select first in-stock
// choice per option, resolve the buyer's selections to a Wix variant, gate add-to-cart on stock +
// mandatory modifiers, and build the addToCart payload. The data paths here (variant resolution,
// modifier keys, stock gating) are the bug-prone part — keep them verbatim; the PDP page only
// renders what this returns.
import { useState, useEffect, useMemo } from "react";
import { getProductBySlug } from "@/rest/wix-store-catalog";
import { storeImage } from "@/lib/storeImage";
import { useCart } from "@/context/CartContext";

export function useProductDetail(slug) {
  const { addToCart } = useCart();
  const [product, setProduct] = useState(null);
  const [notFound, setNotFound] = useState(false);
  // A missing product (notFound) and a failed request (error) need different pages: one is a dead
  // link, the other is worth retrying. Without the split, a network blip reads as "product deleted".
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [selectedOptions, setSelectedOptions] = useState({});
  const [modifierValues, setModifierValues] = useState({});
  const [quantity, setQuantity] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setProduct(null);
    setNotFound(false);
    setError(null);
    getProductBySlug(slug)
      .then((p) => {
        if (cancelled) return;
        if (!p) return setNotFound(true);
        setProduct(p);
        const initial = {};
        (p.options || []).forEach((o) => {
          const first = o.choicesSettings?.choices?.find((c) => c.inStock !== false);
          if (first) initial[o.id] = first.choiceId;
        });
        setSelectedOptions(initial);
      })
      .catch((e) => { if (!cancelled) setError(e?.message || "Couldn't load this product."); });
    return () => { cancelled = true; };
  }, [slug, reloadKey]);

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

  // A colour choice carries `linkedMedia` — the shots of the product in that colour. Picking "Dark
  // Green" should move the gallery to the green photo, so resolve the selection to a URL here; only
  // colour-style choices have linked media, so the first hit across the options is the right one.
  const focusMediaUrl = useMemo(() => {
    for (const o of options) {
      const choice = (o.choicesSettings?.choices || []).find((c) => c.choiceId === selectedOptions[o.id]);
      const url = storeImage(choice?.linkedMedia?.[0]);
      if (url) return url;
    }
    return null;
  }, [options, selectedOptions]);

  const selectOption = (optionId, choiceId) => setSelectedOptions((s) => ({ ...s, [optionId]: choiceId }));
  const setModifier = (key, value) => setModifierValues((s) => ({ ...s, [key]: value }));

  async function submit() {
    const modifierChoices = {}, customTextFields = {};
    modifiers.forEach((m) => {
      const k = m.modifierRenderType === "FREE_TEXT" ? m.freeTextSettings?.key : m.key;
      if (!k || !modifierValues[k]) return;
      (m.modifierRenderType === "FREE_TEXT" ? customTextFields : modifierChoices)[k] = modifierValues[k];
    });
    setAdding(true);
    try {
      // addToCart reports its own failures through the cart context (it opens the drawer with the
      // reason), so nothing is swallowed by leaving this unguarded beyond resetting the button.
      // Coerce the quantity: the shipped stepper lets the field sit empty mid-edit, and a keyboard
      // submit from that state would otherwise post "" as the quantity.
      await addToCart(product.id, variant?.id, Math.max(1, Number(quantity) || 1), {
        modifierChoices: Object.keys(modifierChoices).length ? modifierChoices : undefined,
        customTextFields: Object.keys(customTextFields).length ? customTextFields : undefined,
      });
    } finally {
      setAdding(false);
    }
  }

  return {
    product, notFound, error, retry: () => setReloadKey((k) => k + 1),
    options, modifiers,
    selectedOptions, selectOption, modifierValues, setModifier,
    quantity, setQuantity, variant, inStock, canAdd, adding, price, submit, focusMediaUrl,
  };
}
