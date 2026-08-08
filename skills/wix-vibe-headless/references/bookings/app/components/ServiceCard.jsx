// Grid tile for one bookable service. Styled with base44 design tokens (shadcn Tailwind classes:
// bg-card / text-foreground / border-border / text-primary) — re-skin via the app's design tokens
// (src/index.css :root/.dark), not this JSX. The load-bearing bits: the image goes through mediaUrl()
// (Wix media can be a bare handle), the id is `service.id`, and the price is built from value+currency
// because `formattedValue` is OPTIONAL (rendering it alone leaves the price blank when it's absent).
import { Link } from "react-router-dom";
import { mediaUrl } from "@/rest/wix-bookings-services";

function servicePrice(service) {
  const p = service?.payment?.fixed?.price;
  if (!p) return null;                                      // free / custom-priced
  return p.formattedValue
    || new Intl.NumberFormat(undefined, { style: "currency", currency: p.currency }).format(Number(p.value));
}

export default function ServiceCard({ service }) {
  const image = mediaUrl(service.media?.mainMedia?.image ?? service.media?.items?.[0]?.image ?? service.media?.coverMedia?.image);
  const price = servicePrice(service);

  return (
    <Link to={`/service/${service.id}`}
      className="flex flex-col no-underline text-foreground bg-card border border-border rounded-lg overflow-hidden shadow-sm">
      <div className="relative aspect-[4/3] bg-background">
        {image
          ? <img src={image} alt={service.name} loading="lazy" className="w-full h-full object-cover" />
          : <div className="w-full h-full" />}
      </div>
      <div className="p-3 flex flex-col gap-1">
        <h3 className="m-0 font-display text-[15px] font-semibold">{service.name}</h3>
        {service.tagLine && <p className="m-0 text-muted-foreground text-[13px]">{service.tagLine}</p>}
        {price && <span className="font-semibold text-primary">{price}</span>}
      </div>
    </Link>
  );
}
