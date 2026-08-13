// useEventDetail — load one event by slug and derive its registration state. No markup.
//   • getEventBySlug returns null on miss → notFound (never invent an event).
//   • registration.type is "RSVP" | "TICKETING" | "EXTERNAL" | "NONE" — the detail page branches on it.
//   • Only registration.status values starting "OPEN_" accept new registrations; otherwise `open` is
//     false and the page shows the closed state.
//   • shortDescription is a plain string (safe to render). event.description is Ricos rich content
//     { nodes: [...] } — NOT a string; render with @wix/ricos or walk nodes, never call string
//     methods on it (that crashes the page). This hook does not touch description.
import { useState, useEffect } from "react";
import { getEventBySlug } from "@/rest/wix-events-browse";

export function useEventDetail(slug) {
  const [event, setEvent] = useState(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setEvent(null);
    setNotFound(false);
    getEventBySlug(slug).then((e) => (e ? setEvent(e) : setNotFound(true)));
  }, [slug]);

  const reg = event?.registration ?? {};
  const type = reg.type ?? "NONE";
  const open = typeof reg.status === "string" && reg.status.startsWith("OPEN_");

  return { event, notFound, type, open, registration: reg };
}
