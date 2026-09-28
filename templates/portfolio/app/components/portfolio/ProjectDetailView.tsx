// REFERENCE project detail: header, details[] rows (text or link), media gallery (image AND
// video items) on the @theme tokens. Correct and complete; per the skill's model you design
// and build your own on useProjectDetail. The gallery items render through the SHIPPED
// GalleryMedia (kind branching, poster, link wrap) — keep that in whatever you build.
import { useProjectDetail } from "../../hooks/portfolio/useProjectDetail";
import { imgAttrs } from "../../wix/media";
import type { GalleryItem, ProjectDetail } from "../../wix/portfolio/types";
import { GalleryLink, GalleryMedia } from "./GalleryMedia";

export interface ProjectDetailViewProps {
  slug: string;
  initialProject?: ProjectDetail;
  initialItems?: GalleryItem[];
}

export default function ProjectDetailView({ slug, initialProject, initialItems }: ProjectDetailViewProps) {
  const { project, notFound, items, error } = useProjectDetail(slug, { initialProject, initialItems });

  if (notFound) {
    return <p className="py-16 text-center text-muted-foreground">Project not found.</p>;
  }
  if (!project) {
    return (
      <div aria-busy="true">
        <div className="h-7 w-64 animate-pulse rounded bg-secondary" />
        <div className="mt-6 aspect-[4/3] animate-pulse rounded-lg bg-secondary" />
      </div>
    );
  }

  return (
    <article>
      <header className="mb-8 max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight">{project.title}</h1>
        {project.description && (
          <p className="mt-2 leading-relaxed text-muted-foreground">{project.description}</p>
        )}
        {project.details.length > 0 && (
          <dl className="mt-5 grid grid-cols-[auto_1fr] items-baseline gap-x-6 gap-y-1.5">
            {project.details.map((d, i) => (
              <div key={i} className="contents">
                <dt className="text-sm text-muted-foreground">{d.label}</dt>
                <dd className="m-0 text-sm text-foreground">
                  {d.url ? (
                    <a href={d.url} target={d.target ?? undefined} rel="noopener" className="underline">
                      {d.text}
                    </a>
                  ) : (
                    d.text
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </header>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {items === null ? (
        <div className="flex flex-col gap-6" aria-busy="true">
          <div className="aspect-[4/3] animate-pulse rounded-lg bg-secondary" />
        </div>
      ) : items.length === 0 ? (
        // No gallery items — the cover is the project's only real media; text-only otherwise.
        project.imageUrl ? (
          <img {...imgAttrs(project.imageUrl, "(min-width: 1024px) 64rem, 100vw", 0.75)} alt={project.title} className="block w-full rounded-lg" />
        ) : (
          <p className="py-16 text-center text-muted-foreground">No media in this project yet.</p>
        )
      ) : (
        <div className="flex flex-col gap-6">
          {items.map((item) => (
            <figure key={item.id} className="m-0">
              <GalleryLink item={item}>
                <GalleryMedia item={item} className="block w-full rounded-lg bg-secondary" />
              </GalleryLink>
              {item.title && (
                <figcaption className="mt-1.5 text-sm text-muted-foreground">{item.title}</figcaption>
              )}
            </figure>
          ))}
        </div>
      )}
    </article>
  );
}
