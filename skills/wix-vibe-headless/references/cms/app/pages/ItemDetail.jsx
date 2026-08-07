// Item detail page — thin view over useItemDetail (all logic in the hook). Renders the mapped
// fields: image, date, title, and the long body. The body is treated as HTML (CMS rich-text fields
// come back as HTML); it renders via dangerouslySetInnerHTML only when it's a string. Token-styled;
// re-skin via theme.css.
import { useParams } from "react-router-dom";
import { useItemDetail } from "@/hooks/useItemDetail";
import { FIELDS } from "@/collection.config";
import { wixImage } from "@/lib/wixImage";

export default function ItemDetail() {
  const { key } = useParams();
  const { item, notFound } = useItemDetail(key);

  if (notFound) return <Centered>Not found.</Centered>;
  if (!item) return <Centered>Loading…</Centered>;

  const image = FIELDS.image ? wixImage(item[FIELDS.image]) : null;
  const title = item[FIELDS.title];
  const date = FIELDS.date && item[FIELDS.date]
    ? new Date(item[FIELDS.date]).toLocaleDateString()
    : null;
  const body = FIELDS.body ? item[FIELDS.body] : null;
  const summary = FIELDS.summary ? item[FIELDS.summary] : null;

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "calc(var(--space) * 1.5) var(--space)" }}>
      {date && <p style={{ color: "var(--color-muted)", fontSize: 13, margin: "0 0 8px" }}>{date}</p>}
      <h1 style={{ fontFamily: "var(--font-display)", margin: "0 0 var(--space)" }}>{title}</h1>

      {image && (
        <div style={{
          aspectRatio: "16 / 9", background: "var(--color-surface)",
          borderRadius: "var(--radius)", overflow: "hidden", marginBottom: "calc(var(--space) * 1.5)",
        }}>
          <img src={image} alt={title || ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
      )}

      {typeof body === "string"
        ? <div style={{ color: "var(--color-text)", lineHeight: 1.7 }}
            dangerouslySetInnerHTML={{ __html: body }} />
        : summary && <p style={{ color: "var(--color-text)", lineHeight: 1.7 }}>{summary}</p>}
    </main>
  );
}

function Centered({ children }) {
  return <div style={{ padding: "calc(var(--space) * 3)", textAlign: "center", color: "var(--color-muted)" }}>{children}</div>;
}
