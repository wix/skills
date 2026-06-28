import { useState } from "react";
import BookingForm, { type BookingFormField } from "./BookingForm";
import type { SelectedSlot } from "./bookingDriver";

// CourseEnrollFlow.tsx — client:only="react" coordinator for COURSE services.
// A course is enrolled as a whole series, so there is NO availability calendar and
// NO time-slot picker (unlike APPOINTMENT/CLASS → ServiceBookingFlow). Instead it
// shows the course schedule + remaining capacity and an Enroll action that reveals
// the same schema-driven BookingForm, driving bookingDriver.book() with a synthetic
// COURSE slot (the driver sends bookedEntity.schedule.scheduleId — see buildBookingRequest).
//
// Capacity is computed SSR (Query Extended Bookings needs elevated perms a browser
// visitor token doesn't have) and passed in. When `capacity` is null (e.g. an own/static
// build that can't read it client-side), we hide the live count and rely on the server's
// own capacity validation in createBooking to reject a full course.

export interface CourseCapacity {
  totalCapacity: number;
  remaining: number;
  isFull: boolean;
}

export interface CourseSession {
  start: string;
  end?: string;
  durationMin?: number;
  staff?: string;
}

interface Props {
  service: any;
  serviceName: string;
  fields: BookingFormField[];
  scheduleId: string;
  firstSessionStart?: string;
  lastSessionEnd?: string;
  capacity?: CourseCapacity | null;
  /** upcoming session events (so visitors see what they're signing up for) */
  sessions?: CourseSession[];
  /** true total of upcoming sessions (the rendered list may be capped) */
  sessionCount?: number;
  /** course location label (from the session events) */
  location?: string;
  /** service.bookingPolicy.bookAfterStartPolicy.enabled — may join after first session */
  bookAfterStart?: boolean;
}

const fmtDay = (d?: string) =>
  d ? new Date(d).toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" }) : "";
const fmtSession = (d: string) =>
  new Date(d).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default function CourseEnrollFlow({
  service,
  serviceName,
  fields,
  scheduleId,
  firstSessionStart,
  lastSessionEnd,
  capacity,
  sessions,
  sessionCount,
  location,
  bookAfterStart,
}: Props) {
  const [enrolling, setEnrolling] = useState(false);
  const [sessionsPage, setSessionsPage] = useState(0);
  const SESSIONS_PER_PAGE = 7;

  const tz = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
  })();

  // Has the course already started? (only blocks enrollment when bookAfterStart is off)
  const started = firstSessionStart ? new Date(firstSessionStart).getTime() < Date.now() : false;
  const closedAfterStart = started && !bookAfterStart;
  const isFull = capacity?.isFull ?? false;
  const enrollable = !!scheduleId && !!firstSessionStart && !isFull && !closedAfterStart;

  const slot: SelectedSlot = {
    serviceType: "COURSE",
    serviceId: service._id,
    scheduleId,
    localStartDate: firstSessionStart ?? "",
    localEndDate: lastSessionEnd ?? firstSessionStart ?? "",
    timezone: tz,
    locationType: "BUSINESS",
  };

  const handleSuccess = (_orderId: string) => {
    const params = new URLSearchParams();
    params.set("service", serviceName);
    if (firstSessionStart) params.set("startDate", firstSessionStart);
    window.location.href = `/booking-confirmation?${params.toString()}`;
  };

  return (
    <div className="course-enroll">
      <dl className="course-schedule">
        {firstSessionStart && (
          <div className="course-schedule-row">
            <dt>Runs</dt>
            <dd>{fmtDay(firstSessionStart)}{lastSessionEnd ? ` – ${fmtDay(lastSessionEnd)}` : ""}</dd>
          </div>
        )}
        {location && (
          <div className="course-schedule-row">
            <dt>Location</dt>
            <dd>{location}</dd>
          </div>
        )}
        {capacity ? (
          <div className="course-schedule-row">
            <dt>Available spots</dt>
            <dd>{isFull ? "Fully booked" : `${capacity.remaining} of ${capacity.totalCapacity}`}</dd>
          </div>
        ) : (
          service.defaultCapacity ? (
            <div className="course-schedule-row">
              <dt>Capacity</dt>
              <dd>Limited to {service.defaultCapacity} participants</dd>
            </div>
          ) : null
        )}
      </dl>

      {sessions && sessions.length > 0 && (() => {
        const pageCount = Math.ceil(sessions.length / SESSIONS_PER_PAGE);
        const page = Math.min(sessionsPage, pageCount - 1);
        const startIdx = page * SESSIONS_PER_PAGE;
        const pageItems = sessions.slice(startIdx, startIdx + SESSIONS_PER_PAGE);
        return (
          <div className="course-sessions">
            <h3 className="course-sessions-title">Upcoming sessions</h3>
            {sessionCount ? (
              <p className="course-sessions-count">Total of {sessionCount} session{sessionCount === 1 ? "" : "s"}</p>
            ) : null}
            <ol className="course-sessions-list">
              {pageItems.map((s) => (
                <li key={s.start} className="course-sessions-item">
                  <span className="course-sessions-when">{fmtSession(s.start)}</span>
                  {(s.durationMin || s.staff) && (
                    <span className="course-sessions-meta">
                      {[s.durationMin ? `${s.durationMin} min` : null, s.staff].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </li>
              ))}
            </ol>
            {pageCount > 1 && (
              <div className="course-sessions-pager">
                <button type="button" className="course-sessions-pager-btn" disabled={page === 0}
                  onClick={() => setSessionsPage(page - 1)}>Previous</button>
                <span className="course-sessions-pager-status">Page {page + 1} of {pageCount}</span>
                <button type="button" className="course-sessions-pager-btn" disabled={page >= pageCount - 1}
                  onClick={() => setSessionsPage(page + 1)}>Next</button>
              </div>
            )}
          </div>
        );
      })()}

      {isFull && <p className="course-note course-note-full">This course is fully booked.</p>}
      {!isFull && closedAfterStart && (
        <p className="course-note">Enrollment has closed — this course has already started.</p>
      )}
      {!firstSessionStart && (
        <p className="course-note">No sessions are scheduled for this course yet.</p>
      )}

      {enrollable && !enrolling && (
        <button type="button" className="booking-cta" onClick={() => setEnrolling(true)}>
          Enroll in this course
        </button>
      )}

      {enrollable && enrolling && (
        <BookingForm
          service={service}
          serviceName={serviceName}
          slot={slot}
          fields={fields}
          onSuccess={handleSuccess}
          onCancel={() => setEnrolling(false)}
        />
      )}
    </div>
  );
}
