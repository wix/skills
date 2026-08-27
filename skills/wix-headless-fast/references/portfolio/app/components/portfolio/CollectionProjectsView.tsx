// REFERENCE collection page: collection header + its projects grid on the @theme tokens.
// Correct and complete; per the skill's model you design and build your own on
// useCollectionProjects (ProjectCard is reusable for an all-work grid or a home strip).
import type { ComponentType, ReactNode } from "react";
import { useCollectionProjects } from "../../hooks/portfolio/useCollectionProjects";
import type { CollectionSummary, ProjectSummary } from "../../wix/portfolio/types";

export interface LinkLikeProps {
  href: string;
  className?: string;
  children?: ReactNode;
}

const PlainLink = ({ href, className, children }: LinkLikeProps) => (
  <a href={href} className={className}>
    {children}
  </a>
);

export interface ProjectCardProps {
  project: ProjectSummary;
  projectHref?: (slug: string) => string;
  LinkComponent?: ComponentType<LinkLikeProps>;
}

export function ProjectCard({
  project,
  projectHref = (slug) => `/projects/${slug}`,
  LinkComponent = PlainLink,
}: ProjectCardProps) {
  return (
    <LinkComponent href={projectHref(project.slug)} className="group block no-underline">
      <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-secondary">
        {project.imageUrl && (
          <img
            src={project.imageUrl}
            alt={project.title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        )}
      </div>
      <p className="mt-3 text-sm font-medium text-foreground">{project.title}</p>
      {project.description && (
        <p className="mt-0.5 text-xs text-muted-foreground">{project.description}</p>
      )}
    </LinkComponent>
  );
}

export interface CollectionProjectsViewProps {
  slug: string;
  initialCollection?: CollectionSummary;
  initialProjects?: ProjectSummary[];
  emptyMessage?: string;
  projectHref?: ProjectCardProps["projectHref"];
  LinkComponent?: ComponentType<LinkLikeProps>;
  CardComponent?: ComponentType<ProjectCardProps>;
}

export default function CollectionProjectsView({
  slug,
  initialCollection,
  initialProjects,
  emptyMessage = "No projects in this collection yet.",
  projectHref,
  LinkComponent,
  CardComponent = ProjectCard,
}: CollectionProjectsViewProps) {
  const { collection, notFound, projects, error } = useCollectionProjects(slug, {
    initialCollection,
    initialProjects,
  });

  if (notFound) {
    return <p className="py-16 text-center text-muted-foreground">Collection not found.</p>;
  }

  return (
    <div>
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          {collection ? collection.title : <span className="inline-block h-7 w-48 animate-pulse rounded bg-secondary" />}
        </h1>
        {collection?.description && (
          <p className="mt-2 max-w-2xl text-muted-foreground">{collection.description}</p>
        )}
      </header>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {projects === null ? (
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i}>
              <div className="aspect-[4/3] animate-pulse rounded-lg bg-secondary" />
              <div className="mt-3 h-3.5 w-2/3 animate-pulse rounded bg-secondary" />
            </div>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">{emptyMessage}</p>
      ) : (
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <CardComponent key={p.id} project={p} projectHref={projectHref} LinkComponent={LinkComponent} />
          ))}
        </div>
      )}
    </div>
  );
}
