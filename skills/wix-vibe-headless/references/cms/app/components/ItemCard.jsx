// List tile for one CMS item. Pure UI: which fields to show comes from collection.config (FIELDS),
// styling comes entirely from theme.css tokens (var(--...)) — re-skin via those, not this JSX. The
// image conversion (wixImage) and the slug-or-_id route key (itemKey) are load-bearing.
import { Link } from "react-router-dom";
import { FIELDS, itemKey } from "@/collection.config";
import { wixImage } from "@/lib/wixImage";

export default function ItemCard({ item }) {
  const image = FIELDS.image ? wixImage(item[FIELDS.image]) : null;
  const title = item[FIELDS.title];
  const summary = FIELDS.summary ? item[FIELDS.summary] : null;
  const date = FIELDS.date && item[FIELDS.date]
    ? new Date(item[FIELDS.date]).toLocaleDateString()
    : null;

  return (
    <Link to={`/item/${itemKey(item)}`} style={{
      display: "flex", flexDirection: "column", textDecoration: "none",
      color: "var(--color-text)", background: "var(--color-surface)",
      border: "1px solid var(--color-border)", borderRadius: "var(--radius)",
      overflow: "hidden", boxShadow: "var(--shadow)",
    }}>
      <div style={{ aspectRatio: "16 / 10", background: "var(--color-bg)" }}>
        {image
          ? <img src={image} alt={title || ""} loading="lazy"
              style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <div style={{ width: "100%", height: "100%" }} />}
      </div>
      <div style={{ padding: "calc(var(--space) * 0.75)", display: "flex", flexDirection: "column", gap: 6 }}>
        {date && <span style={{ color: "var(--color-muted)", fontSize: 12 }}>{date}</span>}
        <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 600 }}>{title}</h3>
        {summary && (
          <p style={{ margin: 0, color: "var(--color-muted)", fontSize: 14, lineHeight: 1.5 }}>{summary}</p>
        )}
      </div>
    </Link>
  );
}
