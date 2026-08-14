// Project detail — thin view over useProjectDetail (all data logic lives in the hook). Renders the
// header, the details[] rows (text OR link), and the media gallery (each item via ProjectMedia,
// which branches on item.type). Styled with base44 design tokens (shadcn Tailwind classes).
import { useParams } from "react-router-dom";
import { useProjectDetail } from "@/hooks/useProjectDetail";
import ProjectMedia from "@/components/ProjectMedia";

export default function ProjectDetail() {
  const { slug } = useParams();
  const { project, notFound, items } = useProjectDetail(slug);

  if (notFound) return <Centered>Project not found.</Centered>;
  if (!project) return <Centered>Loading…</Centered>;

  const details = project.details || [];
  return (
    <main className="max-w-[1200px] mx-auto p-4">
      <header className="mb-6">
        <h1 className="font-display m-0 mb-2">{project.title}</h1>
        {project.description && (
          <p className="text-muted-foreground leading-relaxed m-0">{project.description}</p>
        )}
      </header>

      {/* details[] row: { label, text? } OR { label, link: { text, url, target } } */}
      {details.length > 0 && (
        <dl className="grid [grid-template-columns:auto_1fr] gap-x-6 gap-y-2 m-0 mb-8 items-baseline">
          {details.map((d, i) => (
            <div key={i} className="contents">
              <dt className="text-muted-foreground text-sm">{d.label}</dt>
              <dd className="m-0">
                {d.link
                  ? <a href={d.link.url} target={d.link.target} rel="noopener"
                      className="text-primary">{d.link.text}</a>
                  : d.text}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div className="flex flex-col gap-4">
        {items.map((item) => (
          <figure key={item.id} className="m-0">
            {item.link
              ? <a href={item.link.url} target={item.link.target} rel="noopener"><ProjectMedia item={item} /></a>
              : <ProjectMedia item={item} />}
            {item.title && (
              <figcaption className="text-muted-foreground text-sm mt-1.5">{item.title}</figcaption>
            )}
          </figure>
        ))}
      </div>
    </main>
  );
}

function Centered({ children }) {
  return <div className="p-12 text-center text-muted-foreground">{children}</div>;
}
