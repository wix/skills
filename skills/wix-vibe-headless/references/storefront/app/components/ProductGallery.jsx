// PDP image gallery — main image plus thumbnails from productGallery(product), which puts
// media.main first and drops the duplicate of it that media.itemsInfo.items carries. A product with a
// single image renders just the main frame, so this is safe for a one-photo catalog.
// Styled with base44 design tokens (shadcn Tailwind classes).
import { useEffect, useState } from "react";

export default function ProductGallery({ images, name, focusUrl }) {
  const [index, setIndex] = useState(0);
  // Reset when navigating between products — the component stays mounted across a slug change.
  // `images` must keep a stable identity per product (the PDP memoises it), or every parent render —
  // a quantity bump, an option click — would land here and throw away the image the buyer picked.
  useEffect(() => { setIndex(0); }, [images]);

  // Picking a colour swatch shows that colour: focusUrl is the choice's linked photo. Runs after the
  // reset effect, so a first paint with a colour pre-selected opens on the right image.
  useEffect(() => {
    const i = images?.findIndex((img) => img.url === focusUrl) ?? -1;
    if (i >= 0) setIndex(i);
  }, [focusUrl, images]);

  const current = images?.[index];

  return (
    <div className="flex flex-col gap-3">
      <div className="aspect-square bg-card rounded-lg overflow-hidden">
        {current ? (
          <img src={current.url} alt={current.altText || name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-muted flex items-center justify-center" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="w-10 h-10 text-muted-foreground/40" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" />
            </svg>
          </div>
        )}
      </div>

      {images?.length > 1 && (
        <div className="flex gap-2 flex-wrap" role="group" aria-label={`${name} images`}>
          {images.map((img, i) => (
            <button key={img.url} onClick={() => setIndex(i)} aria-label={`Show image ${i + 1}`} aria-current={i === index}
              className={`w-16 h-16 rounded-sm overflow-hidden cursor-pointer bg-card border ${
                i === index ? "border-primary" : "border-border"
              }`}>
              <img src={img.url} alt="" loading="lazy" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
