// Service detail + booking page — thin view over useServiceDetail (all logic lives in the hook):
// pick a slot, enter details, book → hosted checkout. Two columns: what you're booking on the left,
// the booking panel on the right, sticky on desktop so the times stay in reach while reading.
// Styled with base44 design tokens (shadcn Tailwind classes).
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
  const { price, minutes, capacity, location, rescheduleNote, needsApproval } = d.facts;

  return (
    <main className="max-w-[1200px] mx-auto p-4 grid gap-8 items-start lg:[grid-template-columns:1fr_minmax(360px,420px)]">
      <div>
        <div className="aspect-[4/3] bg-card rounded-lg overflow-hidden mb-5">
          {image && <img src={image} alt={d.service.name} className="w-full h-full object-cover" />}
        </div>

        {d.service.category?.name && (
          <p className="m-0 mb-1.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            {d.service.category.name}
          </p>
        )}
        <h1 className="font-display m-0 mb-3">{d.service.name}</h1>
        {d.service.description && (
          <p className="text-muted-foreground leading-relaxed mb-6 max-w-[62ch]">{d.service.description}</p>
        )}

        {/* The three facts a buyer checks before picking a time. Each cell renders only when the
            service actually carries it, so a class with no fixed duration doesn't leave a blank. */}
        <dl className="m-0 flex flex-wrap border border-border rounded-lg overflow-hidden divide-x divide-border">
          {minutes && <Fact label="Duration" value={`${minutes} minutes`} />}
          {price && <Fact label="Price" value={price} />}
          {location && <Fact label="Where" value={location} />}
          {!minutes && capacity && <Fact label="Capacity" value={capacity} />}
        </dl>
      </div>

      <div className="min-w-0 bg-card border border-border rounded-lg p-5 lg:sticky lg:top-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
          <h2 className="font-display text-lg m-0">Choose a time</h2>
          {/* The zone the API returned the times in — not a locally guessed one, so the label and
              the times on screen can't disagree. */}
          {d.timeZone && (
            <span className="text-[13px] text-muted-foreground">Times in {d.timeZone.replace(/_/g, " ")}</span>
          )}
        </div>

        <SlotPicker
          slots={d.slots} cursor={d.cursor} onLoadMore={d.loadMoreSlots}
          selectedSlot={d.selectedSlot} onPick={d.pickSlot}
        />

        {d.selectedSlot && (
          <div className="mt-6 pt-6 border-t border-border">
            <BookingForm
              contact={d.contact} setContactField={d.setContactField}
              maxParticipants={d.maxParticipants} participants={d.participants} setParticipants={d.setParticipants}
              onSubmit={d.submit} submitting={d.submitting} canSubmit={d.canSubmit} error={d.error}
              needsApproval={needsApproval}
              timeLabel={new Date(d.selectedSlot.localStartDate).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
              priceLabel={price}
            />
            <p className="m-0 mt-3 text-[13px] text-muted-foreground text-center">
              You'll pay on the next screen.{rescheduleNote ? ` ${rescheduleNote}` : ""}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

function Fact({ label, value }) {
  return (
    <div className="flex-1 min-w-[110px] p-3">
      <dt className="m-0 text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="m-0 mt-0.5 font-semibold">{value}</dd>
    </div>
  );
}

function Centered({ children }) {
  return <div className="p-12 text-center text-muted-foreground">{children}</div>;
}
