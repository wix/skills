// Collection tile → links to /collection/:slug. Styled with base44 design tokens (shadcn Tailwind
// classes) — re-skin via the app's design tokens (src/index.css :root/.dark), not this JSX. The
// `//`-protocol image fix and the coverImage.imageInfo.url field path are load-bearing.
import { Link } from "react-router-dom";

function coverUrl(collection) {
  const url = collection?.coverImage?.imageInfo?.url;
  return url ? (url.startsWith("//") ? `https:${url}` : url) : null;
}

export default function CollectionCard({ collection }) {
  const image = coverUrl(collection);

  return (
    <Link to={`/collection/${collection.slug}`}
      className="flex flex-col no-underline text-foreground bg-card border border-border rounded-lg overflow-hidden shadow-sm">
      <div className="aspect-[4/3] bg-background">
        {image
          ? <img src={image} alt={collection.title} loading="lazy"
              className="w-full h-full object-cover" />
          : <div className="w-full h-full" />}
      </div>
      <div className="p-3 flex flex-col gap-1">
        <h3 className="m-0 font-display text-base font-semibold">{collection.title}</h3>
        {collection.description && (
          <p className="m-0 text-muted-foreground text-sm leading-normal">{collection.description}</p>
        )}
      </div>
    </Link>
  );
}
