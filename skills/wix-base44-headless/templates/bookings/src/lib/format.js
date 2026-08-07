// Price + date formatting for services/slots. Build the price from value+currency (always present)
// and use payment.fixed.price.formattedValue only when present — it's optional and rendering it
// alone leaves the price blank whenever it's missing.
export function formatServicePrice(service) {
  const p = service?.payment;
  if (p?.rateType === "NO_FEE") return "Free";
  const fixed = p?.fixed?.price;
  if (!fixed) return p?.rateType === "CUSTOM" || p?.rateType === "VARIED" ? "Varies" : "";
  if (fixed.formattedValue) return fixed.formattedValue;
  const { value, currency } = fixed;
  if (value == null || !currency) return "";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(value));
  } catch {
    return `${value} ${currency}`;
  }
}

// "2026-08-07T14:30:00" (local wall-clock, no zone) -> {day, time} for grouping/rendering.
export function parseLocalSlot(localDate) {
  const [date, clock = ""] = String(localDate).split("T");
  const d = new Date(`${localDate}`);
  const valid = !Number.isNaN(d.getTime());
  return {
    dayKey: date,
    dayLabel: valid ? d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : date,
    timeLabel: valid ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : clock.slice(0, 5),
  };
}
