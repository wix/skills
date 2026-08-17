// Responsive projects grid + empty state. Styled with base44 design tokens (shadcn Tailwind classes).
import ProjectCard from "./ProjectCard";

export default function ProjectGrid({ projects, empty = "No projects yet." }) {
  if (!projects?.length) {
    return (
      <p className="text-muted-foreground p-4 text-center">{empty}</p>
    );
  }
  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
      {projects.map((p) => <ProjectCard key={p.id} project={p} />)}
    </div>
  );
}
