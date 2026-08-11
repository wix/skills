// useServices — the services-list data, no markup: load one page of visitor-visible services and
// page with the returned offset. queryServices returns an OBJECT ({ services, total, nextOffset }),
// NOT a bare array — destructure it (calling .map on the object throws). `total === 0` is the
// empty-state signal; `services === null` means still loading.
import { useState, useEffect, useCallback } from "react";
import { queryServices } from "@/rest/wix-bookings-services";

export function useServices({ limit = 24 } = {}) {
  const [services, setServices] = useState(null);
  const [total, setTotal] = useState(null);
  const [nextOffset, setNextOffset] = useState(null);

  useEffect(() => {
    queryServices({ limit }).then(({ services, total, nextOffset }) => {
      setServices(services);
      setTotal(total);
      setNextOffset(nextOffset);
    });
  }, [limit]);

  const loadMore = useCallback(() => {
    if (nextOffset == null) return;                        // null on the last page
    queryServices({ limit, offset: nextOffset }).then(({ services: more, nextOffset: next }) => {
      setServices((s) => [...(s || []), ...more]);
      setNextOffset(next);
    });
  }, [limit, nextOffset]);

  return { services, total, nextOffset, loadMore };
}
