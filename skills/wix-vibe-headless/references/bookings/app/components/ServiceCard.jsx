// Grid tile for one bookable service. Styled with base44 design tokens (shadcn Tailwind classes:
// bg-card / text-foreground / border-border / text-primary) — re-skin via the app's design tokens
// (src/index.css :root/.dark), not this JSX. Load-bearing: the image goes through mediaUrl() (Wix
// media can be a bare handle), the link uses `service.id`, and every price/duration/capacity label
// comes from lib/serviceFacts.js so the card and the detail page can't disagree.
import { Link } from "react-router-dom";
import { mediaUrl } from "@/rest/wix-bookings-services";
import { serviceCapacityLabel, serviceDuration, servicePriceLabel } from "@/lib/serviceFacts";

export default function ServiceCard({ service }) {
  const image = mediaUrl(service.media?.mainMedia?.image ?? service.media?.items?.[0]?.image ?? service.media?.coverMedia?.image);
  const price = servicePriceLabel(service);
  const minutes = serviceDuration(service);
  // A class has no duration on the service, so its meta row carries capacity alone rather than a gap.
  const facts = [minutes && `${minutes} min`, serviceCapacityLabel(service)].filter(Boolean);

  return (
    <Link to={`/service/${service.id}`}
      className="group flex flex-col no-underline text-foreground bg-card border border-border rounded-lg overflow-hidden shadow-sm">
      <div className="relative aspect-[4/3] bg-background overflow-hidden">
        {image
          ? <img src={image} alt={service.name} loading="lazy"
              className="w-full h-full object-cover transition-transform duration-300 md:group-hover:scale-[1.03]" />
          : <div className="w-full h-full bg-muted flex items-center justify-center" aria-hidden="true"><svg viewBox="0 0 24 24" className="w-8 h-8 text-muted-foreground/40" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg></div>}
      </div>

      <div className="p-3 flex flex-col gap-1">
        {/* Name and price share a row on a wide tile and stack on a phone's narrow one, where a long
            name against a top-right price wraps into a ragged block. */}
        <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between md:gap-3">
          <h3 className="m-0 font-display text-[15px] font-semibold line-clamp-2">{service.name}</h3>
          {price && <span className="font-semibold whitespace-nowrap">{price}</span>}
        </div>

        {service.tagLine && (
          <p className="m-0 text-muted-foreground text-[13px] line-clamp-1">{service.tagLine}</p>
        )}

        {facts.length > 0 && (
          <p className="m-0 mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            {facts.join(" · ")}
          </p>
        )}
      </div>
    </Link>
  );
}
