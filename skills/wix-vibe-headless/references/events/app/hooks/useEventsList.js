// useEventsList — all listing logic, no markup: load the category menu + upcoming count, list
// events (all or filtered by category), and page with offset "load more". The data shapes here are
// the bug-prone part — keep them verbatim; the Events page only renders what this returns.
//   • queryEvents / listEventsByCategory return { events, total, offset, nextOffset } — an OBJECT,
//     not a bare array; nextOffset is null when there are no more pages.
//   • queryEventCategories returns { categories, total }; render category.name,
//     key/filter by category.id, count = counts.assignedEventsCount.
//   • total === 0 → the whole catalog is empty; show the "publish events" empty state.
import { useState, useEffect } from "react";
import {
  queryEvents, listEventsByCategory, queryEventCategories, countUpcomingEvents,
} from "@/rest/wix-events-browse";

export function useEventsList({ pageSize = 24 } = {}) {
  const [events, setEvents] = useState([]);
  const [nextOffset, setNextOffset] = useState(null); // offset for the next page; null when no more
  const [categories, setCategories] = useState([]);   // category menu
  const [active, setActive] = useState(null);          // selected category id, or null for "all"
  const [total, setTotal] = useState(null);            // upcoming count across the whole catalog
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    countUpcomingEvents().then(setTotal);
    queryEventCategories().then(({ categories }) => setCategories(categories));
  }, []);

  useEffect(() => {
    setLoading(true);
    const load = active
      ? listEventsByCategory(active, { limit: pageSize })
      : queryEvents({ limit: pageSize });
    load.then(({ events, nextOffset }) => {
      setEvents(events);
      setNextOffset(nextOffset);
      setLoading(false);
    });
  }, [active, pageSize]);

  const loadMore = () => {
    if (nextOffset === null) return;
    const load = active
      ? listEventsByCategory(active, { limit: pageSize, offset: nextOffset })
      : queryEvents({ limit: pageSize, offset: nextOffset });
    load.then(({ events: more, nextOffset: next }) => {
      setEvents((e) => [...e, ...more]);
      setNextOffset(next);
    });
  };

  return {
    events, categories, active, setActive,
    total, loading, hasMore: nextOffset !== null, loadMore,
  };
}
