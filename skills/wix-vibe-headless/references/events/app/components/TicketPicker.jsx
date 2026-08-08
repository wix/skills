// Ticket picker for a TICKETING event. Pure UI over useTicketing — no data logic here. Styled with
// base44 design tokens (shadcn Tailwind classes).
//   • Ticket-definition price is a plain number at pricing.fixedPrice.amount (+ price.currency here).
//   • FREE-only selection → an in-app buyer form + checkoutTickets (no redirect).
//   • Any PAID ticket → "Continue to checkout", which reserves then redirects to the Wix-hosted form.
import { useState } from "react";
import { useTicketing } from "@/hooks/useTicketing";

const input = "px-3 py-2.5 box-border font-body border border-border rounded-sm bg-background text-foreground";

function ticketPrice(def) {
  if (def.free) return "Free";
  const amount = def.price?.amount ?? def.pricing?.fixedPrice?.amount;
  const currency = def.price?.currency ?? def.pricing?.fixedPrice?.currency ?? "";
  return amount != null ? `${amount} ${currency}`.trim() : "";
}

export default function TicketPicker({ event }) {
  const t = useTicketing(event);
  const [buyer, setBuyer] = useState({ firstName: "", lastName: "", email: "" });
  const setBuyerField = (k, v) => setBuyer((b) => ({ ...b, [k]: v }));

  if (t.order) {
    return (
      <div className="p-4 rounded-lg bg-card border border-border">
        Your tickets are confirmed.{" "}
        {t.order.ticketsPdf && (
          <a href={t.order.ticketsPdf} target="_blank" rel="noopener" className="text-primary">Download tickets (PDF)</a>
        )}
      </div>
    );
  }

  if (!t.definitions.length) {
    return <p className="text-muted-foreground">No tickets are currently on sale.</p>;
  }

  const buyerReady = buyer.firstName && buyer.lastName && buyer.email;

  return (
    <div>
      {t.definitions.map((def) => (
        <div key={def.id} className="flex items-center justify-between gap-4 py-3 border-b border-border">
          <div>
            <div className="font-semibold">{def.name}</div>
            {def.description && <div className="text-muted-foreground text-sm">{def.description}</div>}
            <div className="text-primary font-semibold mt-0.5">{ticketPrice(def)}</div>
          </div>
          <input type="number" min={0} value={t.selection[def.id]?.quantity ?? 0}
            onChange={(e) => t.setQuantity(def.id, Number(e.target.value) || 0)}
            className={`${input} w-[72px] text-center`} />
        </div>
      ))}

      {t.error && <p className="text-destructive mt-4">{t.error}</p>}

      {t.hasSelection && t.allFree && (
        <div className="mt-4 grid gap-2 max-w-[440px]">
          <input className={`${input} w-full`} placeholder="First name" value={buyer.firstName}
            onChange={(e) => setBuyerField("firstName", e.target.value)} />
          <input className={`${input} w-full`} placeholder="Last name" value={buyer.lastName}
            onChange={(e) => setBuyerField("lastName", e.target.value)} />
          <input className={`${input} w-full`} type="email" placeholder="Email" value={buyer.email}
            onChange={(e) => setBuyerField("email", e.target.value)} />
        </div>
      )}

      {t.hasSelection && (
        <button
          disabled={t.submitting || (t.allFree && !buyerReady)}
          onClick={() => (t.allFree ? t.checkoutFree(buyer) : t.checkoutPaid())}
          className="mt-4 py-3 px-6 cursor-pointer bg-primary text-primary-foreground border-none rounded-sm text-[15px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
          {t.submitting ? "Processing…" : t.allFree ? "Get tickets" : "Continue to checkout"}
        </button>
      )}
    </div>
  );
}
