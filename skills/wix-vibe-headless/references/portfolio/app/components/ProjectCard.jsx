// Project tile → links to /project/:slug. Styled with base44 design tokens (shadcn Tailwind classes)
// — re-skin via the app's design tokens (src/index.css :root/.dark), not this JSX. The cover is a
// one-of: image when present, else the video's poster / first resolution. The `//`-protocol fix and
// these field paths are load-bearing.
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
    <Link to={`/project/${project.slug}`}
      className="flex flex-col no-underline text-foreground bg-card border border-border rounded-lg overflow-hidden shadow-sm">
      <div className="aspect-[4/3] bg-background">
        {image
          ? <img src={image} alt={project.title} loading="lazy"
              className="w-full h-full object-cover" />
          : <div className="w-full h-full bg-muted flex items-center justify-center" aria-hidden="true"><svg viewBox="0 0 24 24" className="w-8 h-8 text-muted-foreground/40" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg></div>}
      </div>
      <div className="p-3 flex flex-col gap-1">
        <h3 className="m-0 font-display text-[15px] font-semibold">{project.title}</h3>
        {project.description && (
          <p className="m-0 text-muted-foreground text-sm leading-normal">{project.description}</p>
        )}
      </div>
    </Link>
  );
}
