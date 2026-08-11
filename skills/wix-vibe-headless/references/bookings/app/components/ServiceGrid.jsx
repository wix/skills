// Responsive service grid + empty state. Styled with base44 design tokens (shadcn Tailwind classes).
import ServiceCard from "./ServiceCard";

export default function ServiceGrid({ services, empty = "No services yet." }) {
  if (!services?.length) {
    return <p className="text-muted-foreground p-4 text-center">{empty}</p>;
  }
  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
      {services.map((s) => <ServiceCard key={s.id} service={s} />)}
    </div>
  );
}
