// useMyPlans — "My plans" logic, no markup: load the logged-in member's orders and re-sync on
// visibilitychange so a plan bought via hosted checkout shows up on return. getMyPlanOrders()
// resolves to an ARRAY ([] for anonymous visitors — never throws), so the view can show a
// "log in to see your plans" state. Keep the visibilitychange re-sync — it is load-bearing.
import { useState, useEffect, useCallback } from "react";
import { getMyPlanOrders } from "@/rest/wix-pricing-plans";

export function useMyPlans({ orderStatuses = ["ACTIVE"] } = {}) {
  const [orders, setOrders] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => {
    // [] for anonymous visitors (no member context) — never throws.
    getMyPlanOrders({ orderStatuses }).then((o) => { setOrders(o); setLoaded(true); });
  }, [orderStatuses]);

  useEffect(() => {                                   // load once + re-sync on return from hosted checkout
    refresh();
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  return { orders, loaded, refresh };
}
