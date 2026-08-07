// One gallery media item. Branch on item.type ("IMAGE" | "VIDEO" | "UNDEFINED") — this branching
// and the field paths (image.imageInfo.url, video.videoInfo.resolutions[0].url) are load-bearing;
// re-skin via theme.css, don't rewire the paths. Token-styled.

function https(url) {
  return url ? (url.startsWith("//") ? `https:${url}` : url) : null;
}

export default function ProjectMedia({ item }) {
  if (item.type === "IMAGE") {
    const src = https(item.image?.imageInfo?.url);
    return src ? (
      <img src={src} alt={item.title || ""} loading="lazy"
        style={{ display: "block", width: "100%", height: "auto", borderRadius: "var(--radius-sm)" }} />
    ) : null;
  }
  if (item.type === "VIDEO") {
    // resolutions[].url is the confirmed field; posters[0] is the poster (sub-shape not in the
    // helper JSDoc — posters[0].url used here; confirm in wix-docs if a brand needs more).
    const vi = item.video?.videoInfo;
    const src = https(vi?.resolutions?.[0]?.url);
    const poster = https(vi?.posters?.[0]?.url);
    return src ? (
      <video src={src} poster={poster || undefined} controls playsInline
        style={{ display: "block", width: "100%", height: "auto", borderRadius: "var(--radius-sm)", background: "var(--color-surface)" }} />
    ) : null;
  }
  return null; // UNDEFINED — nothing renderable
}
