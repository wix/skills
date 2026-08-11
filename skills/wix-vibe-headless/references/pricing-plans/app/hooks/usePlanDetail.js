// usePlanDetail — plan-detail logic, no markup: load a single PUBLIC plan by its URL slug, expose a
// notFound flag (getPlanBySlug returns null on a miss — show a not-found state, never invent a
// plan), and start the members-only hosted checkout. Mirrors the storefront's useProductDetail.
// The detail page only renders what this returns.
import { useState, useEffect } from "react";
import { getPlanBySlug, checkout } from "@/rest/wix-pricing-plans";

export function usePlanDetail(slug) {
  const [plan, setPlan] = useState(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setPlan(null);
    setNotFound(false);
    getPlanBySlug(slug).then((p) => {
      if (!p) return setNotFound(true);
      setPlan(p);
    });
  }, [slug]);

  // members-only, Wix-hosted checkout; on success Wix returns to thankYouPageUrl with ?planOrderId=<GUID>
  async function subscribe() {
    if (!plan) return;
    window.location.href = await checkout(plan.id, { thankYouPageUrl: `${window.location.origin}/my-plans` });
  }

  return { plan, notFound, subscribe };
}
