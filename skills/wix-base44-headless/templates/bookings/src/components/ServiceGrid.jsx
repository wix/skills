// Responsive service grid + empty state. Token-styled; re-skin via theme.css.
import ServiceCard from "./ServiceCard";

export default function ServiceGrid({ services, empty = "No services yet." }) {
  if (!services?.length) {
    return <p style={{ color: "var(--color-muted)", padding: "var(--space)", textAlign: "center" }}>{empty}</p>;
  }
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
      gap: "var(--space)",
    }}>
      {services.map((s) => <ServiceCard key={s.id || s._id} service={s} />)}
    </div>
  );
}
