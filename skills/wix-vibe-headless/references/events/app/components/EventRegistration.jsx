// Registration surface for the detail page — branches on registration.type and respects `open`
// (only OPEN_* statuses accept new registrations). Pure UI; the RSVP/ticketing logic lives in their
// own hooks/components. Token-styled; re-skin via theme.css.
import RsvpForm from "./RsvpForm";
import TicketPicker from "./TicketPicker";

const closed = { color: "var(--color-danger)", fontWeight: 600 };
const link = {
  display: "inline-block", padding: "12px 24px", textDecoration: "none",
  background: "var(--color-primary)", color: "var(--color-on-primary)",
  border: "none", borderRadius: "var(--radius-sm)", fontSize: 15, fontWeight: 600,
};

export default function EventRegistration({ event, type, open, registration }) {
  if (type === "EXTERNAL") {
    return registration.external?.url
      ? <a href={registration.external.url} target="_blank" rel="noopener" style={link}>Register</a>
      : null;
  }
  if (type === "NONE") return null;

  if (type === "RSVP") {
    return open
      ? <RsvpForm eventId={event.id} responseType={registration.rsvp?.responseType} />
      : <p style={closed}>Registration is closed.</p>;
  }
  if (type === "TICKETING") {
    return open
      ? <TicketPicker event={event} />
      : <p style={closed}>Ticket sales are closed.</p>;
  }
  return null;
}
