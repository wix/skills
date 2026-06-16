import { useState } from "react";
import AvailabilityCalendar, { type StaffMemberOption, type LocationOption } from "./AvailabilityCalendar";
import BookingForm, { type BookingFormField } from "./BookingForm";
import type { SelectedSlot } from "./bookingDriver";

// ServiceBookingFlow.tsx — client:only="react" coordinator island. Holds the
// selected-slot state shared between the calendar and the form, transitions
// between them, and redirects to the confirmation page on success. The SSR
// detail page passes the full `service` (the driver reads its payment/policy),
// the booking-form `fields` (the @wix/forms schema), the service's `staffMembers`
// (for the optional staff picker), the service's business `locations` + the
// catalog-chosen `locationId` (so the calendar scopes availability to one
// location — see AvailabilityCalendar) through to the calendar.
//
// This is the framework-agnostic flow shape (a step coordinator + shared
// selection state). On another framework, the same two steps + shared state can
// be route-driven instead — see references/bookings/FLOW.md.

interface Props {
  service: any;
  serviceName: string;
  serviceType: "APPOINTMENT" | "CLASS";
  fields: BookingFormField[];
  staffMembers?: StaffMemberOption[];
  locations?: LocationOption[];
  locationId?: string;
}

export default function ServiceBookingFlow({
  service,
  serviceName,
  serviceType,
  fields,
  staffMembers,
  locations,
  locationId,
}: Props) {
  const [selectedSlot, setSelectedSlot] = useState<SelectedSlot | null>(null);

  const handleSuccess = (_orderId: string, startDate?: string) => {
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (serviceName) params.set("service", serviceName);
    window.location.href = `/booking-confirmation?${params.toString()}`;
  };

  if (!selectedSlot) {
    return (
      <AvailabilityCalendar
        serviceId={service._id}
        serviceName={serviceName}
        serviceType={serviceType}
        staffMembers={staffMembers}
        locations={locations}
        locationId={locationId}
        onSlotSelected={setSelectedSlot}
      />
    );
  }

  return (
    <BookingForm
      service={service}
      serviceName={serviceName}
      slot={selectedSlot}
      fields={fields}
      onSuccess={handleSuccess}
      onCancel={() => setSelectedSlot(null)}
    />
  );
}
