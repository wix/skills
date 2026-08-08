// Service detail + booking page — thin view over useServiceDetail (all logic lives in the hook):
// pick a slot, enter details, book → hosted checkout. Token-styled; re-skin via theme.css.
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
    <main style={{
      maxWidth: "var(--maxw)", margin: "0 auto", padding: "var(--space)",
      display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "calc(var(--space) * 2)",
    }}>
      <div>
        <div style={{
          aspectRatio: "4 / 3", background: "var(--color-surface)",
          borderRadius: "var(--radius)", overflow: "hidden", marginBottom: "var(--space)",
        }}>
          {image && <img src={image} alt={d.service.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
        </div>
        <h1 style={{ fontFamily: "var(--font-display)", margin: "0 0 8px" }}>{d.service.name}</h1>
        {d.price && <p style={{ fontSize: 22, fontWeight: 600, color: "var(--color-accent)", margin: "0 0 var(--space)" }}>{d.price}</p>}
        {d.service.description && (
          <p style={{ color: "var(--color-muted)", lineHeight: 1.6, marginBottom: "var(--space)" }}>{d.service.description}</p>
        )}
        {locations.length > 0 && (
          <p style={{ color: "var(--color-muted)", fontSize: 14, margin: 0 }}>{locations.join(" · ")}</p>
        )}
      </div>

      <div>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, margin: "0 0 var(--space)" }}>Pick a time</h2>
        <SlotPicker
          slots={d.slots} cursor={d.cursor} onLoadMore={d.loadMoreSlots}
          selectedSlot={d.selectedSlot} onPick={d.pickSlot}
        />

        {d.selectedSlot && (
          <div style={{ marginTop: "calc(var(--space) * 1.5)" }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18, margin: "0 0 var(--space)" }}>Your details</h2>
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
  return <div style={{ padding: "calc(var(--space) * 3)", textAlign: "center", color: "var(--color-muted)" }}>{children}</div>;
}
