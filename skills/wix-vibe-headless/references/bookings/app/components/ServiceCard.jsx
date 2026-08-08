// Grid tile for one bookable service. Styled entirely from theme.css tokens (var(--...)) — re-skin
// via those tokens, not this JSX. The load-bearing bits: the image goes through mediaUrl() (Wix
// media can be a bare handle), the id is `service.id`, and the price is built from value+currency
// because `formattedValue` is OPTIONAL (rendering it alone leaves the price blank when it's absent).
import { Link } from "react-router-dom";
import { mediaUrl } from "@/rest/wix-bookings-services";

function servicePrice(service) {
  const p = service?.payment?.fixed?.price;
  if (!p) return null;                                      // free / custom-priced
  return p.formattedValue
    || new Intl.NumberFormat(undefined, { style: "currency", currency: p.currency }).format(Number(p.value));
}

export default function ServiceCard({ service }) {
  const image = mediaUrl(service.media?.mainMedia?.image ?? service.media?.items?.[0]?.image ?? service.media?.coverMedia?.image);
  const price = servicePrice(service);

  return (
    <Link to={`/service/${service.id}`} style={{
      display: "flex", flexDirection: "column", textDecoration: "none",
      color: "var(--color-text)", background: "var(--color-surface)",
      border: "1px solid var(--color-border)", borderRadius: "var(--radius)",
      overflow: "hidden", boxShadow: "var(--shadow)",
    }}>
      <div style={{ position: "relative", aspectRatio: "4 / 3", background: "var(--color-bg)" }}>
        {image
          ? <img src={image} alt={service.name} loading="lazy"
              style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <div style={{ width: "100%", height: "100%" }} />}
      </div>
      <div style={{ padding: "calc(var(--space) * 0.75)", display: "flex", flexDirection: "column", gap: 4 }}>
        <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 600 }}>{service.name}</h3>
        {service.tagLine && (
          <p style={{ margin: 0, color: "var(--color-muted)", fontSize: 13 }}>{service.tagLine}</p>
        )}
        {price && <span style={{ fontWeight: 600, color: "var(--color-accent)" }}>{price}</span>}
      </div>
    </Link>
  );
}
