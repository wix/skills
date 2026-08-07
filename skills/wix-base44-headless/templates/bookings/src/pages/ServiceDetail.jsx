// Service detail + booking flow — thin view over useBookingFlow (all logic lives in the hook).
// Token-styled; re-skin via theme.css.
import { useParams } from "react-router-dom";
import { mediaUrl } from "@/rest/wix-bookings-services";
import { formatServicePrice } from "@/lib/format";
import { useBookingFlow } from "@/hooks/useBookingFlow";
import SlotPicker from "@/components/SlotPicker";
import BookingForm from "@/components/BookingForm";

export default function ServiceDetail() {
  const { serviceId } = useParams();
  const b = useBookingFlow(serviceId);

  if (b.notFound) return <Centered>Service not found.</Centered>;
  if (!b.service) return <Centered>Loading…</Centered>;

  const image = mediaUrl(b.service.media?.items?.[0]?.image);
  const price = formatServicePrice(b.service);

  return (
    <main style={{
      maxWidth: "var(--maxw)", margin: "0 auto", padding: "var(--space)",
      display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "calc(var(--space) * 2)",
    }}>
      <div>
        {image && (
          <div style={{ aspectRatio: "3 / 2", background: "var(--color-surface)", borderRadius: "var(--radius)", overflow: "hidden", marginBottom: "var(--space)" }}>
            <img src={image} alt={b.service.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
        )}
        <h1 style={{ fontFamily: "var(--font-display)", margin: "0 0 4px" }}>{b.service.name}</h1>
        {price && <p style={{ fontSize: 20, fontWeight: 600, margin: "0 0 var(--space)" }}>{price}</p>}
        {b.service.description && (
          <p style={{ color: "var(--color-muted)", lineHeight: 1.6 }}>{b.service.description}</p>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "calc(var(--space) * 1.5)" }}>
        <section>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, margin: "0 0 var(--space)" }}>Pick a time</h2>
          <SlotPicker slots={b.slots} selectedSlot={b.selectedSlot} onSelect={b.setSelectedSlot} />
        </section>

        {b.selectedSlot && (
          <section>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, margin: "0 0 var(--space)" }}>Your details</h2>
            <BookingForm
              contact={b.contact} setContactField={b.setContactField}
              participants={b.participants} setParticipants={b.setParticipants} maxParticipants={b.maxParticipants}
              canBook={b.canBook} submitting={b.submitting} error={b.error} onBook={b.book}
            />
          </section>
        )}
      </div>
    </main>
  );
}

function Centered({ children }) {
  return <div style={{ padding: "calc(var(--space) * 3)", textAlign: "center", color: "var(--color-muted)" }}>{children}</div>;
}
