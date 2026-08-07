// Collection page — collection header + its project grid (paged). Thin view over
// useCollectionProjects (all data logic lives in the hook). Token-styled; re-skin via theme.css.
import { useParams } from "react-router-dom";
import { useCollectionProjects } from "@/hooks/useCollectionProjects";
import ProjectGrid from "@/components/ProjectGrid";

export default function CollectionPage() {
  const { slug } = useParams();
  const { collection, notFound, projects, cursor, loadMore } = useCollectionProjects(slug, { limit: 24 });

  if (notFound) return <Centered>Collection not found.</Centered>;
  if (!collection) return <Centered>Loading…</Centered>;

  return (
    <main style={{ maxWidth: "var(--maxw)", margin: "0 auto", padding: "var(--space)" }}>
      <header style={{ marginBottom: "calc(var(--space) * 1.5)" }}>
        <h1 style={{ fontFamily: "var(--font-display)", margin: "0 0 8px" }}>{collection.title}</h1>
        {collection.description && (
          <p style={{ color: "var(--color-muted)", lineHeight: 1.6, margin: 0 }}>{collection.description}</p>
        )}
      </header>
      {projects === null
        ? <p style={{ color: "var(--color-muted)" }}>Loading…</p>
        : <ProjectGrid projects={projects} empty="No projects in this collection yet." />}
      {cursor && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: "calc(var(--space) * 1.5)" }}>
          <button onClick={loadMore} style={buttonStyle}>Load more</button>
        </div>
      )}
    </main>
  );
}

const buttonStyle = {
  padding: "10px 24px", cursor: "pointer",
  background: "var(--color-primary)", color: "var(--color-on-primary)",
  border: "none", borderRadius: "var(--radius-sm)", fontSize: 15, fontWeight: 600,
};

function Centered({ children }) {
  return <div style={{ padding: "calc(var(--space) * 3)", textAlign: "center", color: "var(--color-muted)" }}>{children}</div>;
}
