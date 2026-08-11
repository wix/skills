// Service detail + booking page — thin view over useServiceDetail (all logic lives in the hook):
// pick a slot, enter details, book → hosted checkout. Styled with base44 design tokens (shadcn Tailwind classes).
import { useParams } from "react-router-dom";
import { useServiceDetail } from "@/hooks/useServiceDetail";
import { mediaUrl } from "@/rest/wix-bookings-services";
import SlotPicker from "@/components/SlotPicker";
import BookingForm from "@/components/BookingForm";

export default function ServiceDetail() {
  const { serviceId } = useParams();
  const d = useServiceDetail(serviceId);

  if (d.notFound) return <Centered>Service not found.</Centered>;
  if (!d.service) return <Centered>Loading…</Centered>;

  const image = mediaUrl(d.service.media?.mainMedia?.image ?? d.service.media?.items?.[0]?.image ?? d.service.media?.coverMedia?.image);
  const locations = (d.service.locations || []).map((l) => l.name || l.formattedAddress).filter(Boolean);

  return (
    <main className="max-w-[1200px] mx-auto p-4 grid gap-8 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
      <div>
        <div className="aspect-[4/3] bg-card rounded-lg overflow-hidden mb-4">
          {image && <img src={image} alt={d.service.name} className="w-full h-full object-cover" />}
        </div>
        <h1 className="font-display m-0 mb-2">{d.service.name}</h1>
        {d.price && <p className="text-[22px] font-semibold text-primary m-0 mb-4">{d.price}</p>}
        {d.service.description && (
          <p className="text-muted-foreground leading-relaxed mb-4">{d.service.description}</p>
        )}
        {locations.length > 0 && (
          <p className="text-muted-foreground text-sm m-0">{locations.join(" · ")}</p>
        )}
      </div>

      <div>
        <h2 className="font-display text-lg m-0 mb-4">Pick a time</h2>
        <SlotPicker
          slots={d.slots} cursor={d.cursor} onLoadMore={d.loadMoreSlots}
          selectedSlot={d.selectedSlot} onPick={d.pickSlot}
        />

        {d.selectedSlot && (
          <div className="mt-6">
            <h2 className="font-display text-lg m-0 mb-4">Your details</h2>
            <BookingForm
              contact={d.contact} setContactField={d.setContactField}
              maxParticipants={d.maxParticipants} participants={d.participants} setParticipants={d.setParticipants}
              onSubmit={d.submit} submitting={d.submitting} canSubmit={d.canSubmit} error={d.error}
            />
          </div>
        )}
      </div>
    </main>
  );
}

function Centered({ children }) {
  return <div className="p-12 text-center text-muted-foreground">{children}</div>;
}
