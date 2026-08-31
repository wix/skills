// useRentalDuration — the extra step a rental has and an ordinary service doesn't: once the
// customer has picked a START, they pick how LONG, and the price follows the length.
//
// Compose it with useServiceDetail rather than replacing it. That hook already loads the
// service, lists start times, holds the contact fields and runs bookAndCheckout — all of which
// a rental uses unchanged. This adds only the second choice and its price:
//
//   const detail = useServiceDetail(serviceId);                       // service + start slots
//   const rental = useRentalDuration(detail.service, detail.selectedSlot, detail.timeZone);
//   // render detail.slots → customer picks a start → render rental.options → picks a length
//   // book with rental.endDate as the slot's localEndDate
//
// Returns empty options for a non-rental service, so a page that renders both kinds needs no
// branch of its own — `isRental(service)` decides whether to show the length step at all.
import { useCallback, useEffect, useState } from "react";
import {
  dailyEndOptions,
  isRental,
  listEndOptions,
  previewRentalPrice,
  rentalDuration,
} from "@/rest/wix-bookings-rentals";

/** "1 hr 30 min" / "2 days" — the label for one length option. */
function lengthLabel(startLocal, endLocal, unit) {
  if (unit === "DAY") {
    const days = Math.round((new Date(`${endLocal}Z`) - new Date(`${startLocal}Z`)) / 86400000);
    return days === 1 ? "1 day" : `${days} days`;
  }
  const minutes = Math.round((new Date(`${endLocal}Z`) - new Date(`${startLocal}Z`)) / 60000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} hr` : "", m ? `${m} min` : ""].filter(Boolean).join(" ") || "0 min";
}

/**
 * @param {object|null} service   The service from useServiceDetail — may be null while loading.
 * @param {object|null} startSlot The slot the customer picked (its localStartDate is the start).
 * @param {string|null} timeZone  The zone the slot list came back in.
 * @returns {{
 *   isRental: boolean,
 *   duration: { unit: "HOUR"|"DAY", min: number, max: number, step: number }|null,
 *   options: { localEndDate: string, label: string }[],
 *   selected: object|null,
 *   select: (option: object) => void,
 *   endDate: string|null,   // pass as the booking's localEndDate
 *   price: { total: string, currency: string|null }|null,
 *   loading: boolean,
 *   error: string|null,
 * }}
 */
export function useRentalDuration(service, startSlot, timeZone) {
  const [options, setOptions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [price, setPrice] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const rental = isRental(service);
  const duration = rentalDuration(service);
  const start = startSlot?.localStartDate ?? null;
  // Forward the chosen slot's own location to end-options.
  const location = startSlot?.location ?? null;
  const serviceId = service?._id || service?.id || null;

  // A new start invalidates the lengths that were valid for the previous one.
  useEffect(() => {
    setSelected(null);
    setPrice(null);
    if (!rental || !start || !serviceId) {
      setOptions([]);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    const load = duration.unit === "DAY"
      ? dailyEndOptions(service, { localStartDate: start, timeZone })
          .then((list) => list.map((o) => ({ localEndDate: o.localEndDate, label: lengthLabel(start, o.localEndDate, "DAY") })))
      : listEndOptions(serviceId, { localStartDate: start, location, timeZone })
          .then(({ endOptions }) =>
            endOptions.map((o) => ({ localEndDate: o.localEndDate, label: lengthLabel(start, o.localEndDate, "HOUR") })),
          );
    load
      .then((list) => {
        if (!alive) return;
        setOptions(list);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        // Fail loudly — an empty length list and a failed call look identical on screen
        // otherwise, and the second one is a bug the visitor should not absorb silently.
        setError(e?.message || "Could not load available lengths.");
        setOptions([]);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rental, serviceId, start, timeZone, duration?.unit]);

  // The price comes from the server for the chosen length — never multiply the rate locally.
  const select = useCallback(
    (option) => {
      setSelected(option);
      setPrice(null);
      if (!option || !serviceId || !start || !timeZone) return;
      previewRentalPrice(serviceId, { localStartDate: start, localEndDate: option.localEndDate, timeZone })
        .then((p) => setPrice({ total: p.total, currency: p.currency }))
        .catch((e) => setError(e?.message || "Could not price that length."));
    },
    [serviceId, start, timeZone],
  );

  return {
    isRental: rental,
    duration,
    options,
    selected,
    select,
    endDate: selected?.localEndDate ?? null,
    price,
    loading,
    error,
  };
}
