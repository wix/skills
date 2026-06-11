import { useEffect, useState } from "react";
import { createClient, OAuthStrategy } from "@wix/sdk";
import { serviceOptionsAndVariants } from "@wix/bookings";
import { WIX_CLIENT_ID } from "astro:env/client";

// VariantSelector.tsx — client:only="react" island shown as step 1 of the booking
// flow only for VARIED-rate services. Fetches the service's single option
// (CUSTOM / DURATION / STAFF_MEMBER) and its variants with per-variant prices,
// then lets the user pick one before proceeding to the availability calendar.

export interface SelectedVariant {
  optionId: string;
  optionType: "CUSTOM" | "STAFF_MEMBER" | "DURATION";
  // Exactly one choice field is set, matching the option type:
  custom?: string;          // CUSTOM — the choice label string, e.g. "Student"
  staffMemberId?: string;   // STAFF_MEMBER — resource ID
  durationMinutes?: number; // DURATION
  label: string;            // display label shown in UI and booking form header
  price: { value: string; currency: string };
}

interface Props {
  serviceId: string;
  serviceName: string;
  onVariantSelected: (variant: SelectedVariant) => void;
}

const wixClient = createClient({
  modules: { serviceOptionsAndVariants },
  auth: OAuthStrategy({ clientId: WIX_CLIENT_ID }),
});

const fmt = (p: { value: string; currency: string }) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: p.currency ?? "USD" }).format(
    Number(p.value),
  );

export default function VariantSelector({ serviceId, serviceName, onVariantSelected }: Props) {
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "none">("loading");
  const [variants, setVariants] = useState<SelectedVariant[]>([]);
  const [optionLabel, setOptionLabel] = useState("Option");

  useEffect(() => {
    void (async () => {
      try {
        // getServiceOptionsAndVariantsByServiceId returns { serviceVariants: { ... } }
        // (note: "serviceVariants" key, not "serviceOptionsAndVariants" — different from
        // the get-by-object-ID response, which uses "serviceOptionsAndVariants").
        const result = await wixClient.serviceOptionsAndVariants.getServiceOptionsAndVariantsByServiceId(serviceId);
        const sv = (result as any).serviceVariants;
        const option = sv?.options?.values?.[0];

        // No option defined → not truly a VARIED service or not yet configured.
        // Return null so ServiceBookingFlow falls through to the calendar.
        if (!option) { setStatus("none"); return; }

        const optionId = option.id as string;
        const optionType = (option.type ?? "CUSTOM") as SelectedVariant["optionType"];

        setOptionLabel(
          optionType === "CUSTOM"       ? (option.customData?.name ?? "Option") :
          optionType === "DURATION"     ? (option.durationData?.name ?? "Duration") :
          /* STAFF_MEMBER */              "Staff Member",
        );

        const parsed: SelectedVariant[] = (sv?.variants?.values ?? []).flatMap((v: any) => {
          const choice = v.choices?.[0] ?? {};
          const price: { value: string; currency: string } = v.price ?? { value: "0", currency: "USD" };

          if (optionType === "CUSTOM") {
            if (!choice.custom) return []; // skip malformed choice
            return [{
              optionId, optionType,
              custom: choice.custom,
              label: choice.custom,
              price,
            }];
          }
          if (optionType === "DURATION") {
            const mins: number | undefined = choice.duration?.minutes;
            if (mins == null) return []; // skip DURATION variant without minutes — unbookable
            const name: string = choice.duration?.name ?? `${mins} min`;
            return [{ optionId, optionType, durationMinutes: mins, label: name, price }];
          }
          // STAFF_MEMBER — staffMemberId is a resource ID. Resolving the display name
          // requires a separate /bookings/v1/staff-members/query call with elevation
          // (staff data isn't public). For a real implementation, fetch staff members
          // SSR-side and pass a staffId→name map as a prop. Here we fall back to "Staff".
          if (!choice.staffMemberId) return []; // skip malformed choice
          return [{
            optionId, optionType,
            staffMemberId: choice.staffMemberId,
            label: "Staff",
            price,
          }];
        });

        setVariants(parsed);
        setStatus(parsed.length > 0 ? "ready" : "none");
      } catch (err) {
        console.error("[variants] fetch failed:", err);
        setStatus("error");
      }
    })();
  }, [serviceId]);

  if (status === "loading") {
    return <p className="availability-loading">Loading pricing options…</p>;
  }
  if (status === "error") {
    return <p className="availability-error">Could not load pricing options — please try again.</p>;
  }
  // "none" → VARIED service exists but no variants are configured yet.
  // Show a message rather than null — returning null silently empties the booking section.
  if (status === "none") {
    return (
      <p className="availability-empty">
        Booking options are not yet available — check back soon or contact us to book.
      </p>
    );
  }

  return (
    <div className="variant-selector">
      <p className="variant-selector-label">Select {optionLabel}</p>
      <div className="variant-options" role="group" aria-label={`Select ${optionLabel} for ${serviceName}`}>
        {variants.map((v, i) => (
          <button
            key={i}
            type="button"
            className="variant-option"
            onClick={() => onVariantSelected(v)}
          >
            <span className="variant-option-label">{v.label}</span>
            <span className="variant-option-price">{fmt(v.price)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
