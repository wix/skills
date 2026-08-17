// Feed tile. Styled with base44 design tokens (shadcn Tailwind classes) — re-skin via those tokens, not this
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
    <Link to={`/blog/${post.slug}`}
      className="flex flex-col no-underline text-foreground bg-card border border-border rounded-lg overflow-hidden shadow-sm">
      {image && (
        <div className="aspect-[16/9] bg-background">
          <img src={image} alt={post.media?.wixMedia?.image?.altText || post.title} loading="lazy"
            className="w-full h-full object-cover" />
        </div>
      )}
      <div className="p-4 flex flex-col gap-2">
        <h3 className="m-0 font-display text-lg font-semibold leading-[1.3]">{post.title}</h3>
        {post.excerpt && (
          <p className="m-0 text-muted-foreground text-sm leading-[1.5]">{post.excerpt}</p>
        )}
        <div className="flex gap-2 items-center text-muted-foreground text-[12px]">
          {date && <span>{date}</span>}
          {date && post.minutesToRead ? <span aria-hidden="true">·</span> : null}
          {post.minutesToRead ? <span>{post.minutesToRead} min read</span> : null}
        </div>
      </div>
    </Link>
  );
}
