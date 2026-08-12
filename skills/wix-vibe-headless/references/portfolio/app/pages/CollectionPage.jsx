// Collection page — collection header + its project grid (paged). Thin view over
// useCollectionProjects (all data logic lives in the hook). Styled with base44 design tokens (shadcn Tailwind classes).
import { useParams } from "react-router-dom";
import { useCollectionProjects } from "@/hooks/useCollectionProjects";
import ProjectGrid from "@/components/ProjectGrid";

export default function CollectionPage() {
  const { slug } = useParams();
  const { collection, notFound, projects, cursor, loadMore } = useCollectionProjects(slug, { limit: 24 });

  if (notFound) return <Centered>Collection not found.</Centered>;
  if (!collection) return <Centered>Loading…</Centered>;

  return (
    <main className="max-w-[1200px] mx-auto p-4">
      <header className="mb-6">
        <h1 className="font-display m-0 mb-2">{collection.title}</h1>
        {collection.description && (
          <p className="text-muted-foreground leading-relaxed m-0">{collection.description}</p>
        )}
      </header>
      {projects === null
        ? <p className="text-muted-foreground">Loading…</p>
        : <ProjectGrid projects={projects} empty="No projects in this collection yet." />}
      {cursor && (
        <div className="flex justify-center mt-6">
          <button onClick={loadMore}
            className="px-6 py-2.5 cursor-pointer bg-primary text-primary-foreground border-none rounded-sm text-[15px] font-semibold">
            Load more
          </button>
        </div>
      )}
    </main>
  );
}

function Centered({ children }) {
  return <div className="p-12 text-center text-muted-foreground">{children}</div>;
}
