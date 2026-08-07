// Feed tile. Styled entirely from theme.css tokens (var(--...)) — re-skin via those tokens, not this
// JSX. The cover-image path (post.media.wixMedia.image.url) and the text-only fallback are
// load-bearing: never substitute a stock/placeholder image. Routes to the detail page by slug.
import { Link } from "react-router-dom";

function coverImage(post) {
  const url = post?.media?.wixMedia?.image?.url;         // ready-to-use https url; //-fix is defensive
  return url ? (url.startsWith("//") ? `https:${url}` : url) : null;
}

function formatDate(iso) {
  if (!iso) return null;
  try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
  catch { return null; }
}

export default function PostCard({ post }) {
  const image = coverImage(post);
  const date = formatDate(post?.firstPublishedDate);

  return (
    <Link to={`/blog/${post.slug}`} style={{
      display: "flex", flexDirection: "column", textDecoration: "none",
      color: "var(--color-text)", background: "var(--color-surface)",
      border: "1px solid var(--color-border)", borderRadius: "var(--radius)",
      overflow: "hidden", boxShadow: "var(--shadow)",
    }}>
      {image && (
        <div style={{ aspectRatio: "16 / 9", background: "var(--color-bg)" }}>
          <img src={image} alt={post.media?.wixMedia?.image?.altText || post.title} loading="lazy"
            style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
      )}
      <div style={{ padding: "var(--space)", display: "flex", flexDirection: "column", gap: 8 }}>
        <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600, lineHeight: 1.3 }}>{post.title}</h3>
        {post.excerpt && (
          <p style={{ margin: 0, color: "var(--color-muted)", fontSize: 14, lineHeight: 1.5 }}>{post.excerpt}</p>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--color-muted)", fontSize: 12 }}>
          {date && <span>{date}</span>}
          {date && post.minutesToRead ? <span aria-hidden="true">·</span> : null}
          {post.minutesToRead ? <span>{post.minutesToRead} min read</span> : null}
        </div>
      </div>
    </Link>
  );
}
