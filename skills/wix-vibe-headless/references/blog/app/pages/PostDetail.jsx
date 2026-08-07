// Post detail — thin view over usePostDetail (all logic lives in the hook). Renders the cover, meta,
// category/tag chips, and the plain-text body as paragraphs. For a faithful render of embeds/images/
// formatting, render `d.post.richContent` with a Ricos renderer (see INSTRUCTIONS "Extending").
// Token-styled; re-skin via theme.css.
import { useParams } from "react-router-dom";
import { usePostDetail } from "@/hooks/usePostDetail";
import PostChips from "@/components/PostChips";

function coverImage(post) {
  const url = post?.media?.wixMedia?.image?.url;
  return url ? (url.startsWith("//") ? `https:${url}` : url) : null;
}

function formatDate(iso) {
  if (!iso) return null;
  try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
  catch { return null; }
}

export default function PostDetail() {
  const { slug } = useParams();
  const d = usePostDetail(slug);

  if (d.notFound) return <Centered>Post not found.</Centered>;
  if (!d.post) return <Centered>Loading…</Centered>;

  const image = coverImage(d.post);
  const date = formatDate(d.post.firstPublishedDate);

  return (
    <main style={{ maxWidth: "var(--maxw)", margin: "0 auto", padding: "var(--space)" }}>
      <article style={{ maxWidth: "var(--measure)", margin: "0 auto" }}>
        <h1 style={{ fontFamily: "var(--font-display)", margin: "0 0 8px", lineHeight: 1.2 }}>{d.post.title}</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--color-muted)", fontSize: 13, marginBottom: "var(--space)" }}>
          {date && <span>{date}</span>}
          {date && d.post.minutesToRead ? <span aria-hidden="true">·</span> : null}
          {d.post.minutesToRead ? <span>{d.post.minutesToRead} min read</span> : null}
        </div>

        {image && (
          <div style={{ borderRadius: "var(--radius)", overflow: "hidden", marginBottom: "calc(var(--space) * 1.5)" }}>
            <img src={image} alt={d.post.media?.wixMedia?.image?.altText || d.post.title}
              style={{ width: "100%", height: "auto", display: "block" }} />
          </div>
        )}

        <div style={{ color: "var(--color-text)", lineHeight: 1.7, fontSize: 17 }}>
          {d.paragraphs.map((para, i) => (
            <p key={i} style={{ margin: "0 0 var(--space)" }}>{para}</p>
          ))}
        </div>

        {(d.cats.length || d.tags.length) ? (
          <div style={{ marginTop: "calc(var(--space) * 2)", paddingTop: "var(--space)", borderTop: "1px solid var(--color-border)" }}>
            <PostChips post={d.post} />
          </div>
        ) : null}
      </article>
    </main>
  );
}

function Centered({ children }) {
  return <div style={{ padding: "calc(var(--space) * 3)", textAlign: "center", color: "var(--color-muted)" }}>{children}</div>;
}
