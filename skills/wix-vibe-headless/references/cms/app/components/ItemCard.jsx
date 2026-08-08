// List tile for one CMS item. Pure UI: which fields to show comes from collection.config (FIELDS),
// styling comes from base44 design tokens (shadcn Tailwind classes) — re-skin via those, not this JSX. The
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
    <Link to={`/item/${itemKey(item)}`}
      className="flex flex-col no-underline text-foreground bg-card border border-border rounded-lg overflow-hidden shadow-sm">
      <div className="aspect-[16/10] bg-background">
        {image
          ? <img src={image} alt={title || ""} loading="lazy" className="w-full h-full object-cover" />
          : <div className="w-full h-full bg-muted flex items-center justify-center" aria-hidden="true"><svg viewBox="0 0 24 24" className="w-8 h-8 text-muted-foreground/40" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg></div>}
      </div>
      <div className="p-3 flex flex-col gap-1.5">
        {date && <span className="text-muted-foreground text-[12px]">{date}</span>}
        <h3 className="m-0 font-display text-base font-semibold">{title}</h3>
        {summary && (
          <p className="m-0 text-muted-foreground text-sm leading-[1.5]">{summary}</p>
        )}
      </div>
    </Link>
  );
}
