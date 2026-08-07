// Service grid tile. Styled from theme.css tokens — re-skin via those tokens, not this JSX.
import { Link } from "react-router-dom";
import { mediaUrl } from "@/rest/wix-bookings-services";
import { formatServicePrice } from "@/lib/format";

export default function ServiceCard({ service }) {
  const image = mediaUrl(service?.media?.items?.[0]?.image);
  const price = formatServicePrice(service);

  return (
    <Link to={`/service/${service.id || service._id}`} style={{
      display: "flex", flexDirection: "column", textDecoration: "none",
      color: "var(--color-text)", background: "var(--color-surface)",
      border: "1px solid var(--color-border)", borderRadius: "var(--radius)",
      overflow: "hidden", boxShadow: "var(--shadow)",
    }}>
      <div style={{ aspectRatio: "3 / 2", background: "var(--color-bg)" }}>
        {image && <img src={image} alt={service.name} loading="lazy"
          style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
      </div>
      <div style={{ padding: "calc(var(--space) * 0.75)", display: "flex", flexDirection: "column", gap: 4 }}>
        <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 600 }}>{service.name}</h3>
        {service.tagLine && <p style={{ margin: 0, color: "var(--color-muted)", fontSize: 13 }}>{service.tagLine}</p>}
        {price && <span style={{ marginTop: 4, fontWeight: 600 }}>{price}</span>}
      </div>
    </Link>
  );
}
