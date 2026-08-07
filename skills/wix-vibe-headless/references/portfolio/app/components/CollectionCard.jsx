// Collection tile → links to /collection/:slug. Styled entirely from theme.css tokens
// (var(--...)) — re-skin via those tokens, not this JSX. The `//`-protocol image fix and the
// coverImage.imageInfo.url field path are load-bearing.
import { Link } from "react-router-dom";

function coverUrl(collection) {
  const url = collection?.coverImage?.imageInfo?.url;
  return url ? (url.startsWith("//") ? `https:${url}` : url) : null;
}

export default function CollectionCard({ collection }) {
  const image = coverUrl(collection);

  return (
    <Link to={`/collection/${collection.slug}`} style={{
      display: "flex", flexDirection: "column", textDecoration: "none",
      color: "var(--color-text)", background: "var(--color-surface)",
      border: "1px solid var(--color-border)", borderRadius: "var(--radius)",
      overflow: "hidden", boxShadow: "var(--shadow)",
    }}>
      <div style={{ aspectRatio: "4 / 3", background: "var(--color-bg)" }}>
        {image
          ? <img src={image} alt={collection.title} loading="lazy"
              style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <div style={{ width: "100%", height: "100%" }} />}
      </div>
      <div style={{ padding: "calc(var(--space) * 0.75)", display: "flex", flexDirection: "column", gap: 4 }}>
        <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 600 }}>{collection.title}</h3>
        {collection.description && (
          <p style={{ margin: 0, color: "var(--color-muted)", fontSize: 14, lineHeight: 1.5 }}>{collection.description}</p>
        )}
      </div>
    </Link>
  );
}
