// Responsive projects grid + empty state. Token-styled; re-skin via theme.css.
import ProjectCard from "./ProjectCard";

export default function ProjectGrid({ projects, empty = "No projects yet." }) {
  if (!projects?.length) {
    return (
      <p style={{ color: "var(--color-muted)", padding: "var(--space)", textAlign: "center" }}>{empty}</p>
    );
  }
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
      gap: "var(--space)",
    }}>
      {projects.map((p) => <ProjectCard key={p.id} project={p} />)}
    </div>
  );
}
