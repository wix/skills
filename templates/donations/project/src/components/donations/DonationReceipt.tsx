// The hosted checkout's thank-you island — wire as-is on /donate/thank-you (mount client:only: it
// reads the browser URL). It owns the honesty rules: landing here with `?orderId=` is Wix's
// success redirect, so it thanks the donor; the order's facts (name, amount, order number, paid or
// pending) appear only when the order could be read; a direct visit with no order id gets a neutral
// thank-you and a link back — never an invented receipt, never "paid" unless the order says PAID.
import { useDonationReceipt } from "../../hooks/donations/useDonationReceipt";

export interface DonationReceiptProps {
  /** Where "Back to campaigns" points. */
  campaignsHref?: string;
  className?: string;
}

export default function DonationReceipt({ campaignsHref = "/donate", className = "mx-auto max-w-lg py-16 text-center" }: DonationReceiptProps) {
  const { orderId, loading, receipt } = useDonationReceipt();

  if (!orderId) {
    return (
      <div className={className}>
        <h1 className="text-2xl font-semibold tracking-tight">Thank you for your support</h1>
        <a href={campaignsHref} className="mt-6 inline-block text-sm text-foreground underline">
          See the campaigns
        </a>
      </div>
    );
  }

  return (
    <div className={className} aria-busy={loading}>
      {receipt?.orderNumber && <p className="eyebrow">Order {receipt.orderNumber}</p>}
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        {receipt?.donorFirstName ? `Thank you, ${receipt.donorFirstName}` : "Thank you for your donation"}
      </h1>
      {receipt && (
        <p className="mt-3 text-sm text-muted-foreground">
          {receipt.amount ? `Your donation of ${receipt.amount} ` : "Your donation "}
          {receipt.paid ? "has been received." : "is being processed — payment is pending."}
        </p>
      )}
      {!receipt && !loading && <p className="mt-3 text-sm text-muted-foreground">Your donation has been submitted.</p>}
      <a href={campaignsHref} className="mt-6 inline-block text-sm text-muted-foreground underline">
        Back to campaigns
      </a>
    </div>
  );
}
