// REFERENCE project detail: header, details[] rows (text or link), media gallery (image AND
// video items) on the @theme tokens. Correct and complete; per the skill's model you design
// and build your own on useProjectDetail. GalleryMedia's kind branching is the load-bearing
// part — keep it (or its logic) in whatever you build.
import type { ReactNode } from "react";
import { useProjectDetail } from "../../hooks/portfolio/useProjectDetail";
import type { GalleryItem, ProjectDetail } from "../../wix/portfolio/types";

/** One gallery item: image, or video with poster. Nothing renderable → null (never a broken tag). */
export function GalleryMedia({ item }: { item: GalleryItem }) {
  if (item.kind === "video" && item.videoUrl) {
    return (
      <video
        src={item.videoUrl}
        poster={item.imageUrl || undefined}
        controls
        playsInline
        className="block w-full rounded-lg bg-secondary"
      />
    );
  }
  if (item.imageUrl) {
    return (
      <img src={item.imageUrl} alt={item.title} loading="lazy" className="block w-full rounded-lg" />
    );
  }
  return null;
}

function MaybeLink({ item, children }: { item: GalleryItem; children: ReactNode }) {
  return item.linkUrl ? (
    <a href={item.linkUrl} target={item.linkTarget ?? undefined} rel="noopener">
      {children}
    </a>
  ) : (
    <>{children}</>
  );
}

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
          <img src={project.imageUrl} alt={project.title} className="block w-full rounded-lg" />
        ) : (
          <p className="py-16 text-center text-muted-foreground">No media in this project yet.</p>
        )
      ) : (
        <div className="flex flex-col gap-6">
          {items.map((item) => (
            <figure key={item.id} className="m-0">
              <MaybeLink item={item}>
                <GalleryMedia item={item} />
              </MaybeLink>
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
