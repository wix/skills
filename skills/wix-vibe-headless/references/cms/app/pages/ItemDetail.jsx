// Item detail page — thin view over useItemDetail (all logic in the hook). Renders the mapped
// fields: image, date, title, and the long body. The body is treated as HTML (CMS rich-text fields
// come back as HTML); it renders via dangerouslySetInnerHTML only when it's a string. Styled with
// base44 design tokens (shadcn Tailwind classes).
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
    <main className="max-w-[760px] mx-auto py-6 px-4">
      {date && <p className="text-muted-foreground text-[13px] m-0 mb-2">{date}</p>}
      <h1 className="font-display m-0 mb-4">{title}</h1>

      {image && (
        <div className="aspect-[16/9] bg-card rounded-lg overflow-hidden mb-6">
          <img src={image} alt={title || ""} className="w-full h-full object-cover" />
        </div>
      )}

      {typeof body === "string"
        ? <div className="text-foreground leading-[1.7]"
            dangerouslySetInnerHTML={{ __html: body }} />
        : summary && <p className="text-foreground leading-[1.7]">{summary}</p>}
    </main>
  );
}

function Centered({ children }) {
  return <div className="p-12 text-center text-muted-foreground">{children}</div>;
}
