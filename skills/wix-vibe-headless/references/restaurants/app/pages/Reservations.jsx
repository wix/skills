// Reservations page — thin view over useReservation (all flow logic lives in the hook). Location
// picker → date + party size → AVAILABLE slots → hold → details → confirm. Reads the confirmed
// reservation's top-level status: RESERVED is confirmed, REQUESTED means the location needs manual
// approval (pending). Styled with base44 design tokens (shadcn Tailwind classes).
import { useReservation } from "@/hooks/useReservation";

const field = "w-full py-2.5 px-3 box-border border border-border rounded-sm bg-background text-foreground font-body";
const primaryBtn = "py-3 px-6 cursor-pointer border-none rounded-sm bg-primary text-primary-foreground text-[15px] font-semibold";

function slotLabel(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function locationLabel(loc) {
  return loc.location?.name || loc.location?.address?.formatted || "Main location";
}

export default function Reservations() {
  const r = useReservation();

  if (r.locations === null) return <Centered>Loading…</Centered>;
  if (r.locations.length === 0) return <Centered>Reservations aren't set up yet — enable Table Reservations in your Wix dashboard.</Centered>;

  if (r.confirmed) {
    const d = r.confirmed.details || {};
    const pending = r.confirmed.status === "REQUESTED";
    return (
      <main className={wrap}>
        <h1 className="font-display">{pending ? "Reservation requested" : "You're booked!"}</h1>
        <p className="text-muted-foreground">
          {pending
            ? "The restaurant will confirm your request shortly."
            : "Your table is confirmed. See you soon!"}
        </p>
        <p>{d.partySize} guests · {d.startDate && new Date(d.startDate).toLocaleString()}</p>
        <button className={primaryBtn} onClick={r.reset}>Make another reservation</button>
      </main>
    );
  }

  return (
    <main className={wrap}>
      <h1 className="font-display mb-4">Reserve a table</h1>

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
        {r.locations.length > 1 && (
          <label>Location
            <select value={r.locationId ?? ""} onChange={(e) => r.setLocationId(e.target.value)} className={field}>
              {r.locations.map((loc) => <option key={loc.id} value={loc.id}>{locationLabel(loc)}</option>)}
            </select>
          </label>
        )}
        <label>Date
          <input type="date" value={r.date} onChange={(e) => r.setDate(e.target.value)} className={field} />
        </label>
        <label>Guests
          <input type="number" min={1} value={r.partySize}
            onChange={(e) => r.setPartySize(Math.max(1, Number(e.target.value) || 1))} className={field} />
        </label>
      </div>

      <div className="mt-4">
        <button className={primaryBtn} disabled={r.loading} onClick={r.findSlots}>Find a table</button>
      </div>

      {r.error && <p className="text-destructive">{r.error}</p>}

      {r.slots && !r.held && (
        r.slots.length === 0
          ? <p className="text-muted-foreground mt-4">No tables available then — try another date or party size.</p>
          : <div className="flex flex-wrap gap-2 mt-4">
              {r.slots.map((slot) => (
                <button key={slot.startDate} onClick={() => r.holdSlot(slot)} disabled={r.loading}
                  className="py-2.5 px-4 cursor-pointer border border-border rounded-sm bg-card text-foreground font-semibold">{slotLabel(slot.startDate)}</button>
              ))}
            </div>
      )}

      {r.held && (
        <form onSubmit={(e) => { e.preventDefault(); r.confirm(); }}
          className="mt-6 flex flex-col gap-3 max-w-[420px]">
          <p className="m-0 text-muted-foreground">
            Holding your table for 10 minutes — enter your details to confirm.
          </p>
          <input required placeholder="First name *" value={r.reservee.firstName}
            onChange={(e) => r.setReservee({ ...r.reservee, firstName: e.target.value })} className={field} />
          <input placeholder="Last name" value={r.reservee.lastName}
            onChange={(e) => r.setReservee({ ...r.reservee, lastName: e.target.value })} className={field} />
          <input required placeholder="Phone (e.g. +15551234567) *" value={r.reservee.phone}
            onChange={(e) => r.setReservee({ ...r.reservee, phone: e.target.value })} className={field} />
          <input type="email" placeholder="Email" value={r.reservee.email}
            onChange={(e) => r.setReservee({ ...r.reservee, email: e.target.value })} className={field} />
          <button type="submit" className={primaryBtn} disabled={r.loading}>Confirm reservation</button>
        </form>
      )}
    </main>
  );
}

const wrap = "max-w-[1040px] mx-auto p-4";
function Centered({ children }) {
  return <div className="p-12 text-center text-muted-foreground">{children}</div>;
}
