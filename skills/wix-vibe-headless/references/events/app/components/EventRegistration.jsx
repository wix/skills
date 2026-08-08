// Registration surface for the detail page — branches on registration.type and respects `open`
// (only OPEN_* statuses accept new registrations). Pure UI; the RSVP/ticketing logic lives in their
// own hooks/components. Styled with base44 design tokens (shadcn Tailwind classes).
import RsvpForm from "./RsvpForm";
import TicketPicker from "./TicketPicker";

const closed = "text-destructive font-semibold";
const link = "inline-block py-3 px-6 no-underline bg-primary text-primary-foreground border-none rounded-sm text-[15px] font-semibold";

export default function EventRegistration({ event, type, open, registration }) {
  if (type === "EXTERNAL") {
    return registration.external?.url
      ? <a href={registration.external.url} target="_blank" rel="noopener" className={link}>Register</a>
      : null;
  }
  if (type === "NONE") return null;

  if (type === "RSVP") {
    return open
      ? <RsvpForm eventId={event.id} responseType={registration.rsvp?.responseType} />
      : <p className={closed}>Registration is closed.</p>;
  }
  if (type === "TICKETING") {
    return open
      ? <TicketPicker event={event} />
      : <p className={closed}>Ticket sales are closed.</p>;
  }
  return null;
}
