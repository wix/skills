import { auth } from "@wix/essentials";
import { discountRules } from "@wix/ecom";

export interface Offer {
  id: string;
  name: string;
  targetedProducts: string[];
}

let _cache: Offer[] | null = null;

/**
 * Memoized per-request discount-rules fetch.
 * Uses auth.elevate() so ECOM.DISCOUNT_RULES_READ is satisfied for visitor clients.
 */
export async function fetchLiveOffers(): Promise<Offer[]> {
  if (_cache) return _cache;

  try {
    const elevatedQuery = auth.elevate(discountRules.queryDiscountRules);
    const result = await elevatedQuery().find();

    _cache = (result.items ?? []).flatMap((rule) => {
      if (!rule._id) return [];
      const name = rule.name ?? "";
      // Collect productIds from all active scopes
      const targetedProducts: string[] = [];
      for (const scope of rule.discountScopes ?? []) {
        for (const ref of scope.catalogItems?.catalogItemFilters ?? []) {
          if (ref.catalogItemId) targetedProducts.push(ref.catalogItemId);
        }
      }
      return [{ id: rule._id, name, targetedProducts }];
    });
  } catch {
    _cache = [];
  }

  return _cache!;
}

/**
 * Return offers that apply to a given productId.
 */
export function offersForProduct(offers: Offer[], productId: string): Offer[] {
  return offers.filter(
    (o) => o.targetedProducts.length === 0 || o.targetedProducts.includes(productId),
  );
}
