// REFERENCE booking surface: time-zone label, staff filter (with photos), the slot picker ONE DAY AT
// A TIME (a strip of the days that have availability with the week pagers at its ends, then that
// day's times bucketed into morning / afternoon / evening) with next availability, a course's dates
// and seats, a class's upcoming sessions, participants, deposit choice, add-ons, the schema-driven
// form, and the CTA labelled from ctaState — on the @theme tokens. A week of a busy calendar is well
// over a hundred slots; listing every day at once buries the form and reads as a wall of numbers.
// Correct and complete; per the skill's model you design and build your own on useBookingFlow.
// Mount client:only — availability is timezone/session-specific.
import { useEffect, useState } from "react";
import { useBookingFlow } from "../../hooks/bookings/useBookingFlow";
import type { CtaState, ServiceDetail, Slot } from "../../wix/bookings/types";

const chip = (selected: boolean, disabled = false) =>
  `rounded-control border px-4 py-1.5 text-sm transition-colors ${
    disabled
      ? "cursor-not-allowed border-border text-muted-foreground line-through opacity-60"
      : selected
        ? "border-primary bg-primary text-primary-foreground"
        : "border-border text-foreground hover:bg-secondary"
  }`;

const dayTile = (selected: boolean) =>
  `w-[68px] shrink-0 rounded-md border px-1 py-2 text-center transition-colors ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground hover:bg-secondary"}`;
const pager = "w-[68px] shrink-0 rounded-md border border-border px-1 py-2 text-center text-xs leading-tight text-foreground transition-colors hover:bg-secondary";

const input = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-shadow focus:ring-2 focus:ring-primary";
const heading = "mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground";

// startLocal is "YYYY-MM-DDThh:mm:ss" (no zone): chars 11–13 are the local hour, no Date parsing needed.
const hourOf = (s: Slot): number => Number(s.startLocal.slice(11, 13));
const BUCKETS: { label: string; test: (h: number) => boolean }[] = [
  { label: "Morning", test: (h) => h < 12 },
  { label: "Afternoon", test: (h) => h >= 12 && h < 17 },
  { label: "Evening", test: (h) => h >= 17 },
];
const fmtDay = (dayKey: string, opts: Intl.DateTimeFormatOptions): string => {
  try {
    return new Date(`${dayKey}T12:00:00`).toLocaleDateString(undefined, opts);
  } catch {
    return dayKey;
  }
};

const dateLabel = (iso: string | null): string => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
};

/** The CTA label follows ctaState, then the money: the deposit when one is being paid, else the price. */
function ctaLabel(service: ServiceDetail, ctaState: CtaState, payDeposit: boolean): string {
  if (ctaState === "viewCourse") return "Not available";
  const verb = ctaState === "requestToBook" ? "Request to book" : "Book";
  if (service.free) return `${verb} — free`;
  if (service.deposit && payDeposit && service.deposit.amount) return `${verb} · deposit ${service.deposit.amount}`;
  if (!service.price) return verb;
  return `${verb} · ${service.priceFrom ? "from " : ""}${service.price}`;
}

export default function ServiceBookingView({ service }: { service: ServiceDetail }) {
  const {
    days,
    nextWeek,
    prevWeek,
    jumpTo,
    nextAvailable,
    staffId,
    setStaffId,
    selectedSlot,
    setSelectedSlot,
    timeZoneLabel,
    displayTimeZone,
    customerCanChangeTimeZone,
    setDisplayTimeZone,
    course,
    offeredDays,
    sessions,
    hasMoreSessions,
    loadMoreSessions,
    participants,
    maxParticipants,
    setParticipants,
    payDeposit,
    setPayDeposit,
    addOnGroups,
    addOns,
    addOnsTotal,
    toggleAddOn,
    setAddOnQuantity,
    canSelectMore,
    formFields,
    values,
    setValue,
    ctaState,
    canBook,
    book,
    booking,
    confirmed,
    error,
  } = useBookingFlow(service);
  const [activeDay, setActiveDay] = useState<string | null>(null);

  // Follow the data: land on the first day with availability, and don't strand the view on a day
  // that left when the week moved.
  useEffect(() => {
    if (days && days.length && !days.some((d) => d.dayKey === activeDay)) setActiveDay(days[0].dayKey);
  }, [days, activeDay]);

  const isCourse = service.type === "COURSE";
  const current = days?.find((d) => d.dayKey === activeDay) ?? days?.[0] ?? null;
  const buckets = current ? BUCKETS.map((b) => ({ label: b.label, slots: current.slots.filter((s) => b.test(hourOf(s))) })).filter((b) => b.slots.length) : [];
  // Switching day drops a slot chosen on another day — otherwise the CTA names a time that isn't on screen.
  const pickDay = (dayKey: string) => {
    setActiveDay(dayKey);
    if (selectedSlot && selectedSlot.dayKey !== dayKey) setSelectedSlot(null);
  };

  if (confirmed) {
    const when = isCourse ? (service.course?.startDate ? ` — starts ${dateLabel(service.course.startDate)}` : "") : selectedSlot ? ` — ${selectedSlot.dayKey} at ${selectedSlot.label}` : "";
    return (
      <div className="rounded-lg border border-border bg-secondary p-8 text-center">
        <p className="text-lg font-semibold">{ctaState === "requestToBook" ? "Request sent" : "You're booked!"}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {service.name}
          {when}.{" "}
          {ctaState === "requestToBook" ? "You'll hear back once the request is approved." : "A confirmation email is on its way."}
        </p>
      </div>
    );
  }

  return (
    <div>
      {isCourse && (
        <div className="mb-5 rounded-lg border border-border p-4 text-sm">
          <p className={heading}>Course</p>
          {service.course?.startDate && (
            <p>
              {dateLabel(service.course.startDate)}
              {service.course.endDate ? ` – ${dateLabel(service.course.endDate)}` : ""}
            </p>
          )}
          {offeredDays.length > 0 && <p className="mt-1 text-muted-foreground">{offeredDays.map((d) => d.slice(0, 3)).join(", ")}</p>}
          {course && course.spotsLeft != null && (
            <p className="mt-1 text-muted-foreground">{course.full ? "Full" : `${course.spotsLeft} spot${course.spotsLeft === 1 ? "" : "s"} left`}</p>
          )}
          {service.course?.ended && <p className="mt-1 text-muted-foreground">This course has ended.</p>}
        </div>
      )}

      {service.staff.length > 1 && !isCourse && (
        <div className="mb-5">
          <p className={heading}>Staff</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={chip(staffId === undefined)} onClick={() => setStaffId(undefined)}>
              Anyone
            </button>
            {service.staff.map((m) => (
              <button key={m.id} type="button" className={`${chip(staffId === m.id)} inline-flex items-center gap-2`} onClick={() => setStaffId(m.id)}>
                {m.imageUrl && <img src={m.imageUrl} alt="" className="h-5 w-5 rounded-full object-cover" />}
                {m.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {!isCourse && (
        <>
          <p className={heading}>Pick a day</p>
          {days === null ? (
            <div className="flex gap-2" aria-busy="true">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="h-14 w-[68px] animate-pulse rounded-md bg-secondary" />
              ))}
            </div>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Choose a day">
              <button type="button" onClick={prevWeek} className={pager} aria-label="Previous week">
                Earlier
              </button>
              {days.length === 0 && (
                <p className="self-center text-sm text-muted-foreground">
                  No times this week.{" "}
                  {nextAvailable && nextAvailable.length > 0 ? (
                    <button type="button" className="underline" onClick={() => jumpTo(nextAvailable[0].dayKey)}>
                      Next available: {nextAvailable[0].dayKey} at {nextAvailable[0].label}
                    </button>
                  ) : nextAvailable === null ? (
                    "Looking for the next available time…"
                  ) : (
                    "Try the next week."
                  )}
                </p>
              )}
              {days.map((day) => (
                <button key={day.dayKey} type="button" aria-pressed={day.dayKey === current?.dayKey} className={dayTile(day.dayKey === current?.dayKey)} onClick={() => pickDay(day.dayKey)}>
                  <span className="block text-[10px] uppercase tracking-wide opacity-70">{fmtDay(day.dayKey, { weekday: "short" })}</span>
                  <span className="block text-lg font-semibold leading-tight">{fmtDay(day.dayKey, { day: "numeric" })}</span>
                </button>
              ))}
              <button type="button" onClick={nextWeek} className={pager} aria-label="Next week">
                More
                <br />
                dates
              </button>
            </div>
          )}

          {current && (
            <div className="mt-5">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium">{fmtDay(current.dayKey, { weekday: "long", month: "short", day: "numeric" })}</p>
                <span className="text-xs text-muted-foreground">
                  {current.slots.length} {current.slots.length === 1 ? "time" : "times"}
                  {timeZoneLabel ? ` · in ${timeZoneLabel}` : ""}
                </span>
              </div>
              {customerCanChangeTimeZone && (
                <p className="mb-3 text-xs text-muted-foreground">
                  <button type="button" className="underline" onClick={() => setDisplayTimeZone(displayTimeZone === "BUSINESS" ? "CUSTOMER" : "BUSINESS")}>
                    {displayTimeZone === "BUSINESS" ? "Show in my time zone" : "Show in the business time zone"}
                  </button>
                </p>
              )}
              <div className="space-y-4">
                {buckets.map((b) => (
                  <div key={b.label}>
                    <p className="mb-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{b.label}</p>
                    <div className="flex flex-wrap gap-2">
                      {b.slots.map((s) => (
                        <button
                          key={s.key}
                          type="button"
                          disabled={!s.bookable}
                          title={s.location?.name || undefined}
                          className={chip(selectedSlot?.key === s.key, !s.bookable)}
                          onClick={() => setSelectedSlot(s)}
                        >
                          {s.label}
                          {!s.bookable ? (s.waitlistCapacity ? " · Full, waitlist" : " · Full") : s.remainingCapacity != null && s.remainingCapacity <= 3 ? ` · ${s.remainingCapacity} left` : ""}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {sessions && sessions.length > 0 && (
        <div className="mt-6">
          <p className={heading}>Upcoming sessions</p>
          <ul className="space-y-1 text-sm">
            {sessions.map((s) => (
              <li key={s.id} className={s.isCancelled ? "text-muted-foreground line-through" : ""}>
                {s.dayLabel} · {s.label}
                {s.staff.length > 0 ? ` · ${s.staff.map((m) => m.name).join(", ")}` : ""}
                {s.isFullyBooked ? " · Full" : s.spotsLeft != null ? ` · ${s.spotsLeft} left` : ""}
              </li>
            ))}
          </ul>
          {hasMoreSessions && (
            <button type="button" className="mt-2 text-sm underline" onClick={() => void loadMoreSessions()}>
              More sessions
            </button>
          )}
        </div>
      )}

      {maxParticipants > 1 && (
        <label className="mt-6 block max-w-md">
          <span className={heading}>Participants</span>
          <select value={participants} onChange={(e) => setParticipants(Number(e.target.value))} className={input}>
            {Array.from({ length: maxParticipants }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
      )}

      {addOnGroups.length > 0 && (
        <div className="mt-6 space-y-4">
          {addOnGroups.map((g) => (
            <div key={g.id}>
              <p className={heading}>{g.prompt || g.name}</p>
              <div className="flex flex-wrap gap-2">
                {g.addOns.map((a) => {
                  const q = addOns[a.id] ?? 0;
                  const blocked = q === 0 && !canSelectMore(g.id);
                  return (
                    <span key={a.id} className="inline-flex items-center gap-1">
                      <button type="button" disabled={blocked} className={chip(q > 0, blocked)} onClick={() => toggleAddOn(a.id)}>
                        {a.name}
                        {a.price ? ` · ${a.price}` : ""}
                        {a.durationMinutes ? ` · +${a.durationMinutes} min` : ""}
                      </button>
                      {q > 0 && a.maxQuantity && a.maxQuantity > 1 && (
                        <select value={q} onChange={(e) => setAddOnQuantity(a.id, Number(e.target.value))} className="rounded-md border border-border bg-background px-2 py-1 text-sm">
                          {Array.from({ length: a.maxQuantity }, (_, i) => i + 1).map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
          {addOnsTotal && <p className="text-sm text-muted-foreground">Add-ons: {addOnsTotal} (added at the venue)</p>}
        </div>
      )}

      {service.deposit?.fullUpfrontAllowed && (
        <div className="mt-6">
          <p className={heading}>Payment</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={chip(payDeposit)} onClick={() => setPayDeposit(true)}>
              Pay deposit{service.deposit.amount ? ` · ${service.deposit.amount}` : ""}
            </button>
            <button type="button" className={chip(!payDeposit)} onClick={() => setPayDeposit(false)}>
              Pay in full{service.price ? ` · ${service.price}` : ""}
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 grid max-w-md gap-3">
        {formFields.map((f) => (
          <label key={f.target} className="block">
            <span className={heading}>{f.label}{f.required ? " *" : ""}</span>
            {f.options?.length ? (
              <select value={values[f.target] ?? ""} onChange={(e) => setValue(f.target, e.target.value)} className={input}>
                <option value="">Choose…</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input
                type={f.type === "EMAIL" ? "email" : f.type === "PHONE" ? "tel" : f.type === "NUMBER" ? "number" : f.type === "URL" ? "url" : "text"}
                value={values[f.target] ?? ""}
                required={f.required}
                onChange={(e) => setValue(f.target, e.target.value)}
                className={input}
              />
            )}
          </label>
        ))}
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      <button
        type="button"
        disabled={!canBook || booking}
        onClick={() => book().catch(() => {})}
        className="mt-5 rounded-control bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {booking ? "Booking…" : ctaLabel(service, ctaState, payDeposit)}
      </button>
    </div>
  );
}
