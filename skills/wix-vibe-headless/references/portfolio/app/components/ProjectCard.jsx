// Project tile → links to /project/:slug. Styled entirely from theme.css tokens (var(--...)) —
// re-skin via those tokens, not this JSX. The cover is a one-of: image when present, else the
// video's poster / first resolution. The `//`-protocol fix and these field paths are load-bearing.
import { Link } from "react-router-dom";

function https(url) {
  return url ? (url.startsWith("//") ? `https:${url}` : url) : null;
}

// coverImage.imageInfo is ONE-OF with coverVideo.videoInfo — fall back through the video.
function coverUrl(project) {
  const image = project?.coverImage?.imageInfo?.url;
  if (image) return https(image);
  const vi = project?.coverVideo?.videoInfo;
  return https(vi?.posters?.[0]?.url || vi?.resolutions?.[0]?.url || null);
}

export default function ProjectCard({ project }) {
  const image = coverUrl(project);

  return (
    <Link to={`/project/${project.slug}`} style={{
      display: "flex", flexDirection: "column", textDecoration: "none",
      color: "var(--color-text)", background: "var(--color-surface)",
      border: "1px solid var(--color-border)", borderRadius: "var(--radius)",
      overflow: "hidden", boxShadow: "var(--shadow)",
    }}>
      <div style={{ aspectRatio: "4 / 3", background: "var(--color-bg)" }}>
        {image
          ? <img src={image} alt={project.title} loading="lazy"
              style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <div style={{ width: "100%", height: "100%" }} />}
      </div>
      <div style={{ padding: "calc(var(--space) * 0.75)", display: "flex", flexDirection: "column", gap: 4 }}>
        <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 600 }}>{project.title}</h3>
        {project.description && (
          <p style={{ margin: 0, color: "var(--color-muted)", fontSize: 14, lineHeight: 1.5 }}>{project.description}</p>
        )}
      </div>
    </Link>
  );
}
