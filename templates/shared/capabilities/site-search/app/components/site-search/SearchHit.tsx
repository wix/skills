// One result row — wire as-is inside your results surface, or use it as the reference for your own:
//   <SearchHit hit={hit} />
// Image (or a placeholder), the highlighted title, the highlighted excerpt, one meta line per type
// (price and stock; category; date and author; date, place and price). The row is a link to the
// hit's route on THIS site; a hit whose slug could not be derived renders unlinked. `titleHtml` and
// `excerptHtml` are the only strings rendered as HTML — they carry text and <mark> only (sanitised in
// search-core). Styled from the @theme tokens.
import { imgAttrs } from "../../wix/media";
import { metaLine } from "../../wix/site-search/search-core";
import type { SearchHit as Hit } from "../../wix/site-search/types";

const MARK = "[&_mark]:rounded-sm [&_mark]:bg-secondary [&_mark]:px-0.5 [&_mark]:text-foreground";

export default function SearchHit({ hit, onNavigate }: { hit: Hit; onNavigate?: (href: string) => void }) {
  const img = imgAttrs(hit.imageUrl, "80px");
  const meta = metaLine(hit);
  const body = (
    <>
      {"src" in img ? (
        <img {...img} alt="" width={80} height={80} className="h-20 w-20 shrink-0 rounded-md bg-secondary object-cover" />
      ) : (
        <div aria-hidden="true" className="h-20 w-20 shrink-0 rounded-md bg-secondary" />
      )}
      <div className="min-w-0 flex-1">
        <h3 className={`text-base font-medium text-foreground ${MARK}`} dangerouslySetInnerHTML={{ __html: hit.titleHtml }} />
        {hit.excerptHtml && <p className={`mt-1 line-clamp-2 text-sm text-muted-foreground ${MARK}`} dangerouslySetInnerHTML={{ __html: hit.excerptHtml }} />}
        {meta && <p className="mt-1 text-xs text-muted-foreground">{meta}</p>}
      </div>
    </>
  );
  const className = "flex gap-4 rounded-lg p-3";
  if (!hit.href) return <div className={className}>{body}</div>;
  return (
    <a
      href={hit.href}
      aria-label={hit.title}
      className={`${className} no-underline transition-colors hover:bg-secondary`}
      onClick={
        onNavigate
          ? (e) => {
              e.preventDefault();
              onNavigate(hit.href);
            }
          : undefined
      }
    >
      {body}
    </a>
  );
}
