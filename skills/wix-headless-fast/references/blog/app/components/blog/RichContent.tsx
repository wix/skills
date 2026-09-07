// The post-body renderer — wire AS-IS (machinery, not a reference). A post body is a Ricos
// document, not HTML and not text: never innerHTML it, never String() its nodes. This is the
// documented render path (@wix/ricos viewer + quick-start plugins).
//
// In Astro this component MUST be a `client:only="react"` island — the ricos viewer breaks
// under SSR. Dark theme: the ricos CSS hardcodes near-black text; scope an override on
// `.ricos-content` forcing the foreground token (in Astro use <style is:global> — React
// islands don't inherit scoped Astro styles).
import { quickStartViewerPlugins, RicosViewer } from "@wix/ricos";
import "@wix/ricos/css/all-plugins-viewer.css";

// Module-level, once — never rebuild the plugin list per render.
const plugins = quickStartViewerPlugins();

export interface RichContentProps {
  /** PostDetail.richContent — the Ricos document (plain JSON). */
  content: Record<string, unknown> | null;
  /** PostDetail.paragraphs — the honest fallback body when richContent is null. */
  fallbackParagraphs?: string[];
}

export default function RichContent({ content, fallbackParagraphs = [] }: RichContentProps) {
  if (content) {
    return (
      <div className="ricos-content">
        <RicosViewer content={content as any} plugins={plugins} />
      </div>
    );
  }
  if (fallbackParagraphs.length > 0) {
    return (
      <div className="space-y-4">
        {fallbackParagraphs.map((p, i) => (
          <p key={i} className="leading-relaxed">
            {p}
          </p>
        ))}
      </div>
    );
  }
  return null;
}
