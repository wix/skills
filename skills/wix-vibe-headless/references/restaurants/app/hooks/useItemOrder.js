// useItemOrder — the item-dialog's add-to-cart logic, no markup: gate on stock + whether ordering
// is available, hold the quantity, and add the line through the order cart. The shipped
// addItemToCart sends operationId + menuId + sectionId + quantity only — the restaurants
// catalogReference.options shape for price-variant / modifier selections is NOT documented for
// client add-to-cart, so modifier groups are DISPLAYED for the diner but not sent (see the dialog
// and INSTRUCTIONS "Extending"). Keep this gating verbatim; the dialog only renders what it returns.
import { useState } from "react";
import { useOrderCart } from "@/context/OrderCartContext";

export function useItemOrder(item, { menuId, sectionId }) {
  const { addItem, ordering } = useOrderCart();
  const [quantity, setQuantity] = useState(1);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(null);

  const inStock = item?.orderSettings?.inStock !== false;
  const canAdd = ordering && inStock && !adding;

  async function submit() {
    setError(null);
    setAdding(true);
    try {
      await addItem(item, { menuId, sectionId }, quantity);   // opens the cart drawer on success
    } catch (e) {
      setError(e.message);                                     // out-of-stock / no operation surfaces here
    } finally {
      setAdding(false);
    }
  }

  return { quantity, setQuantity, inStock, ordering, canAdd, adding, error, submit };
}
