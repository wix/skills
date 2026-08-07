// Service list + count (for the empty state). No markup.
import { useEffect, useState } from "react";
import { queryServices, countServices } from "@/rest/wix-bookings-services";

export function useServices({ limit = 100 } = {}) {
  const [services, setServices] = useState(null);
  const [count, setCount] = useState(null);

  useEffect(() => {
    queryServices({ limit }).then((r) => setServices(r.services));
    countServices().then(setCount);
  }, [limit]);

  return { services, count, loading: services === null };
}
