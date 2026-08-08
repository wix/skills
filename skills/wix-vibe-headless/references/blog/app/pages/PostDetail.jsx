// Post detail — thin view over usePostDetail (all logic lives in the hook). Renders the cover, meta,
// category/tag chips, and the plain-text body as paragraphs. For a faithful render of embeds/images/
// formatting, render `d.post.richContent` with a Ricos renderer (see INSTRUCTIONS "Extending").
// Styled with base44 design tokens (shadcn Tailwind classes).
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
    <main className="max-w-[1100px] mx-auto p-4">
      <article className="max-w-[72ch] mx-auto">
        <h1 className="font-display m-0 mb-2 leading-[1.2]">{d.post.title}</h1>
        <div className="flex gap-2 items-center text-muted-foreground text-[13px] mb-4">
          {date && <span>{date}</span>}
          {date && d.post.minutesToRead ? <span aria-hidden="true">·</span> : null}
          {d.post.minutesToRead ? <span>{d.post.minutesToRead} min read</span> : null}
        </div>

        {image && (
          <div className="rounded-lg overflow-hidden mb-6">
            <img src={image} alt={d.post.media?.wixMedia?.image?.altText || d.post.title}
              className="w-full h-auto block" />
          </div>
        )}

        <div className="text-foreground leading-[1.7] text-[17px]">
          {d.paragraphs.map((para, i) => (
            <p key={i} className="m-0 mb-4">{para}</p>
          ))}
        </div>

        {(d.cats.length || d.tags.length) ? (
          <div className="mt-8 pt-4 border-t border-border">
            <PostChips post={d.post} />
          </div>
        ) : null}
      </article>
    </main>
  );
}

function Centered({ children }) {
  return <div className="p-12 text-center text-muted-foreground">{children}</div>;
}
