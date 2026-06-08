import { useState } from "react";
import AvailabilityCalendar from "./AvailabilityCalendar";
import type { SelectedSlot } from "./AvailabilityCalendar";
import VariantSelector from "./VariantSelector";
import type { SelectedVariant } from "./VariantSelector";
import BookingForm from "./BookingForm";

// ServiceBookingFlow.tsx — client:only="react" coordinator island.
// Three-step flow for VARIED-rate services:
//   1. VariantSelector  — pick an option (e.g. "Adult / Student") and see its price
//   2. AvailabilityCalendar — pick a time slot
//   3. BookingForm — contact details + confirm
// For FIXED / NO_FEE / CUSTOM services step 1 is skipped.
// serviceType MUST be threaded through so the calendar and form pick the right APIs.

interface Props {
  serviceId: string;
  serviceName: string;
  serviceType: "APPOINTMENT" | "CLASS";
  rateType?: string; // "FIXED" | "NO_FEE" | "VARIED" | "CUSTOM"; absent → treated as FIXED
}

export default function ServiceBookingFlow({ serviceId, serviceName, serviceType, rateType }: Props) {
  const [selectedVariant, setSelectedVariant] = useState<SelectedVariant | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<SelectedSlot | null>(null);

  const handleSuccess = (bookingId: string, startDate?: string) => {
    const params = new URLSearchParams();
    if (bookingId) params.set("bookingId", bookingId);
    if (startDate) params.set("startDate", startDate);
    if (serviceName) params.set("service", serviceName);
    window.location.href = `/booking-confirmation?${params.toString()}`;
  };

  // Step 1 — VARIED only: pick a variant before picking a slot.
  // VariantSelector returns null when no variants are configured, which means
  // onVariantSelected is never called — the calendar never appears. Guard for that
  // by rendering null (booking unavailable until variants are set up in the dashboard).
  if (rateType === "VARIED" && !selectedVariant) {
    return (
      <VariantSelector
        serviceId={serviceId}
        serviceName={serviceName}
        onVariantSelected={setSelectedVariant}
      />
    );
  }

  // Step 2 — pick a time slot.
  if (!selectedSlot) {
    return (
      <AvailabilityCalendar
        serviceId={serviceId}
        serviceName={serviceName}
        serviceType={serviceType}
        onSlotSelected={setSelectedSlot}
      />
    );
  }

  // Step 3 — contact details + confirm.
  return (
    <BookingForm
      serviceId={serviceId}
      serviceName={serviceName}
      serviceType={serviceType}
      slot={selectedSlot}
      selectedVariant={selectedVariant ?? undefined}
      onSuccess={handleSuccess}
      onCancel={() => setSelectedSlot(null)}
    />
  );
}
