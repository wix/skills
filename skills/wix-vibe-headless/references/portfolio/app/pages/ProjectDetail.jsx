// Project detail — thin view over useProjectDetail (all data logic lives in the hook). Renders the
// header, the details[] rows (text OR link), and the media gallery (each item via ProjectMedia,
// which branches on item.type). Token-styled; re-skin via theme.css.
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
    <main style={{ maxWidth: "var(--maxw)", margin: "0 auto", padding: "var(--space)" }}>
      <header style={{ marginBottom: "calc(var(--space) * 1.5)" }}>
        <h1 style={{ fontFamily: "var(--font-display)", margin: "0 0 8px" }}>{project.title}</h1>
        {project.description && (
          <p style={{ color: "var(--color-muted)", lineHeight: 1.6, margin: 0 }}>{project.description}</p>
        )}
      </header>

      {/* details[] row: { label, text? } OR { label, link: { text, url, target } } */}
      {details.length > 0 && (
        <dl style={{
          display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 24px",
          margin: "0 0 calc(var(--space) * 2)", alignItems: "baseline",
        }}>
          {details.map((d, i) => (
            <div key={i} style={{ display: "contents" }}>
              <dt style={{ color: "var(--color-muted)", fontSize: 14 }}>{d.label}</dt>
              <dd style={{ margin: 0 }}>
                {d.link
                  ? <a href={d.link.url} target={d.link.target} rel="noopener"
                      style={{ color: "var(--color-accent)" }}>{d.link.text}</a>
                  : d.text}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space)" }}>
        {items.map((item) => (
          <figure key={item.id} style={{ margin: 0 }}>
            {item.link
              ? <a href={item.link.url} target={item.link.target} rel="noopener"><ProjectMedia item={item} /></a>
              : <ProjectMedia item={item} />}
            {item.title && (
              <figcaption style={{ color: "var(--color-muted)", fontSize: 14, marginTop: 6 }}>{item.title}</figcaption>
            )}
          </figure>
        ))}
      </div>
    </main>
  );
}

function Centered({ children }) {
  return <div style={{ padding: "calc(var(--space) * 3)", textAlign: "center", color: "var(--color-muted)" }}>{children}</div>;
}
