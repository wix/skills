// usePlans — Plans-listing logic, no markup: load the first page of PUBLIC plans, page through with
// the cursor, and start a members-only hosted checkout. The destructure of queryPlans() (returns
// { plans, nextCursor }, NOT a bare array) and the checkout-then-redirect are load-bearing — keep
// them. The Plans page only renders what this returns.
import { useState, useEffect } from "react";
import { queryPlans, checkout } from "@/rest/wix-pricing-plans";

export function usePlans() {
  const [plans, setPlans] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // NB: destructure — queryPlans returns { plans, nextCursor }, NOT a bare array.
    queryPlans().then(({ plans, nextCursor }) => { setPlans(plans); setCursor(nextCursor); setLoaded(true); });
  }, []);

  const loadMore = () =>
    queryPlans({ cursor }).then(({ plans: more, nextCursor }) => {
      setPlans((p) => [...p, ...more]);
      setCursor(nextCursor);
    });

  // members-only, Wix-hosted checkout; on success Wix returns to thankYouPageUrl with ?planOrderId=<GUID>
  async function subscribe(plan) {
    window.location.href = await checkout(plan.id, { thankYouPageUrl: `${window.location.origin}/my-plans` });
  }

  return { plans, cursor, loaded, loadMore, subscribe };
}
