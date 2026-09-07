// Services listing + category filter. SSR-friendly: pass server-fetched data as `initial*`
// (Astro frontmatter / server component) and no client fetch happens; a SPA passes nothing.
// Category filtering is client-side (bookings catalogs are small and fully fetched).
import { useEffect, useMemo, useState } from "react";
import { fetchBookingCategories, fetchServices } from "../../wix/bookings/services";
import type { BookingCategory, ServiceSummary } from "../../wix/bookings/types";

export interface UseServicesOptions {
  initialServices?: ServiceSummary[];
  initialCategories?: BookingCategory[];
}

export interface UseServices {
  /** null while the first load is in flight — render skeletons, not an empty state. */
  services: ServiceSummary[] | null;
  categories: BookingCategory[];
  activeCategoryId: string | null;
  setActiveCategoryId: (id: string | null) => void;
  error: string | null;
}

export function useServices({ initialServices, initialCategories }: UseServicesOptions = {}): UseServices {
  const [all, setAll] = useState<ServiceSummary[] | null>(initialServices ?? null);
  const [categories, setCategories] = useState<BookingCategory[]>(initialCategories ?? []);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!initialServices) {
      fetchServices()
        .then((s) => alive && setAll(s))
        .catch((e) => {
          if (!alive) return;
          setAll([]);
          setError(e instanceof Error ? e.message : String(e));
        });
    }
    if (!initialCategories) {
      fetchBookingCategories().then((c) => alive && setCategories(c));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const services = useMemo(() => {
    if (all === null) return null;
    return activeCategoryId ? all.filter((s) => s.categoryId === activeCategoryId) : all;
  }, [all, activeCategoryId]);

  return { services, categories, activeCategoryId, setActiveCategoryId, error };
}
