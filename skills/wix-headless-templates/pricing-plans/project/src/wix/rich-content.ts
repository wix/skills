// Ricos rich content → sanitized HTML or plain text, with no framework. Copy as-is.
//
// A post body, an event description and an FAQ answer are Ricos documents ({ nodes: [...] }), not
// HTML and not text. On a React stack the @wix/ricos viewer renders them; everywhere else (a static
// page, a server template, an email) this does. Text is always escaped, attribute values are escaped,
// links are kept only when http(s) or an in-page anchor, no inline styles, no event attributes;
// `htmlData` is never emitted. A node type outside the table below degrades to its text.

type Raw = Record<string, any>;
/** Media value + size → https URL. Injected: the SDK transport scales through @wix/sdk, REST through the URL form. */
export type ImgSrc = (value: any, width: number, height: number) => string;

export interface RichContentHtmlOptions {
  /**
   * The level (1–6) a Ricos heading of `level` renders at. Default: its own level, never above h2,
   * since the page's h1 is the title of what the document belongs to.
   */
  headingLevel?: (level: number) => number;
  /** Size an inline image is resolved at — one URL per image, wide enough for a prose column. */
  imageWidth?: number;
  imageHeight?: number;
}

const IMAGE_WIDTH = 1200;
const IMAGE_HEIGHT = 800;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const isHttpUrl = (u: unknown): u is string => typeof u === "string" && /^https?:\/\//i.test(u);

/** Ricos Link → the anchor's attributes, or null when the URL is not http(s) (javascript:, data:, relative). */
function linkAttrs(link: Raw | undefined): string | null {
  if (!link) return null;
  if (isHttpUrl(link.url)) {
    const rel = ["noopener", "noreferrer"];
    if (link.rel?.nofollow) rel.push("nofollow");
    if (link.rel?.sponsored) rel.push("sponsored");
    if (link.rel?.ugc) rel.push("ugc");
    const target = link.target === "BLANK" ? ` target="_blank"` : "";
    return `href="${escapeHtml(link.url)}" rel="${rel.join(" ")}"${target}`;
  }
  if (typeof link.anchor === "string" && link.anchor) return `href="#${escapeHtml(link.anchor)}"`;
  return null;
}

/** One TEXT node → inline HTML: escaped text wrapped by its decorations (unknown decorations keep the text). */
function textNodeToHtml(node: Raw): string {
  let html = escapeHtml(String(node.textData?.text ?? ""));
  for (const d of (node.textData?.decorations ?? []) as Raw[]) {
    switch (d?.type) {
      case "BOLD":
        // The editor writes fontWeightValue 700 for bold and a lighter weight to un-bold inside a bold block.
        if (typeof d.fontWeightValue !== "number" || d.fontWeightValue >= 600) html = `<strong>${html}</strong>`;
        break;
      case "ITALIC":
        if (d.italicData !== false) html = `<em>${html}</em>`;
        break;
      case "UNDERLINE": html = `<u>${html}</u>`; break;
      case "STRIKETHROUGH": html = `<s>${html}</s>`; break;
      case "SUPERSCRIPT": html = `<sup>${html}</sup>`; break;
      case "SUBSCRIPT": html = `<sub>${html}</sub>`; break;
      case "LINK": {
        const attrs = linkAttrs(d.linkData?.link);
        if (attrs) html = `<a ${attrs}>${html}</a>`;
        break;
      }
      case "ANCHOR":
        if (typeof d.anchorData?.anchor === "string" && d.anchorData.anchor) html = `<a href="#${escapeHtml(d.anchorData.anchor)}">${html}</a>`;
        break;
      default:
        break; // COLOR, FONT_SIZE, FONT_FAMILY, MENTION, SPOILER, SKETCH, EXTERNAL — text kept, styling dropped
    }
  }
  return html;
}

/**
 * The media value in the form imgSrc scales: `wix:image://v1/<id>/<id>#originWidth=W&originHeight=H`
 * (the Ricos FileSource has no filename; the id stands in — the scaler reads only the id). An absolute
 * https URL passes through; anything else is no image.
 */
export function imageValue(image: Raw | undefined): string {
  const src = image?.src;
  if (!src) return "";
  if (typeof src.id === "string" && src.id) {
    const size = image?.width && image?.height ? `#originWidth=${image.width}&originHeight=${image.height}` : "";
    return `wix:image://v1/${src.id}/${src.id}${size}`;
  }
  return isHttpUrl(src.url) ? src.url : "";
}

interface Ctx {
  imgSrc: ImgSrc;
  headingLevel: (level: number) => number;
  width: number;
  height: number;
}

function imgTag(image: Raw | undefined, alt: unknown, ctx: Ctx): string {
  const src = ctx.imgSrc(imageValue(image), ctx.width, ctx.height);
  if (!src) return "";
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(String(alt ?? ""))}" loading="lazy" decoding="async">`;
}

function childrenToHtml(node: Raw, ctx: Ctx): string {
  return ((node.nodes ?? []) as Raw[]).map((n) => nodeToHtml(n, ctx)).join("");
}

function nodeToHtml(node: Raw, ctx: Ctx): string {
  switch (node?.type) {
    case "TEXT": return textNodeToHtml(node);
    case "PARAGRAPH": return `<p>${childrenToHtml(node, ctx)}</p>`;
    case "HEADING": {
      const level = Math.min(6, Math.max(1, Math.round(ctx.headingLevel(Number(node.headingData?.level) || 2))));
      return `<h${level}>${childrenToHtml(node, ctx)}</h${level}>`;
    }
    case "BULLETED_LIST": return `<ul>${childrenToHtml(node, ctx)}</ul>`;
    case "ORDERED_LIST": return `<ol>${childrenToHtml(node, ctx)}</ol>`;
    case "LIST_ITEM": return `<li>${childrenToHtml(node, ctx)}</li>`;
    case "BLOCKQUOTE": return `<blockquote>${childrenToHtml(node, ctx)}</blockquote>`;
    case "CODE_BLOCK": return `<pre><code>${childrenToHtml(node, ctx)}</code></pre>`;
    case "DIVIDER": return "<hr>";
    case "TABLE": return `<table><tbody>${childrenToHtml(node, ctx)}</tbody></table>`;
    case "TABLE_ROW": return `<tr>${childrenToHtml(node, ctx)}</tr>`;
    case "TABLE_CELL": return `<td>${childrenToHtml(node, ctx)}</td>`;
    case "IMAGE": {
      const img = imgTag(node.imageData?.image, node.imageData?.altText, ctx);
      if (!img) return "";
      const attrs = linkAttrs(node.imageData?.link);
      return attrs ? `<a ${attrs}>${img}</a>` : img;
    }
    case "GALLERY": {
      const imgs = ((node.galleryData?.items ?? []) as Raw[])
        .map((item) => imgTag(item?.image?.media, item?.altText ?? item?.title, ctx))
        .filter(Boolean);
      return imgs.length ? `<figure>${imgs.join("")}</figure>` : "";
    }
    case "VIDEO": {
      // A link to the video, not a player: an embed would need a host-specific iframe.
      const url = node.videoData?.video?.src?.url;
      if (!isHttpUrl(url)) break;
      const label = escapeHtml(String(node.videoData?.title || url));
      return `<p><a href="${escapeHtml(url)}" rel="noopener noreferrer" target="_blank">${label}</a></p>`;
    }
    default:
      break;
  }
  // COLLAPSIBLE_LIST, GIF, HTML, EMBED, APP_EMBED, BUTTON, … (and a video with no link) — text only.
  const text = nodeToText(node).trim();
  return text ? `<p>${escapeHtml(text)}</p>` : "";
}

/** Sanitized HTML for a Ricos document ("" for none). */
export function richContentToHtml(rc: Raw | null | undefined, imgSrc: ImgSrc, options: RichContentHtmlOptions = {}): string {
  const ctx: Ctx = {
    imgSrc,
    headingLevel: options.headingLevel ?? ((level) => Math.max(2, level)),
    width: options.imageWidth ?? IMAGE_WIDTH,
    height: options.imageHeight ?? IMAGE_HEIGHT,
  };
  return ((rc?.nodes ?? []) as Raw[]).map((n) => nodeToHtml(n, ctx)).join("");
}

const INLINE_TYPES = new Set(["TEXT"]);

function nodeToText(node: Raw): string {
  if (node?.type === "TEXT") return String(node.textData?.text ?? "");
  if (node?.type === "BUTTON") return String(node.buttonData?.text ?? "");
  const children = (node?.nodes ?? []) as Raw[];
  const parts = children.map(nodeToText);
  // Blocks join with newlines; inline runs concatenate.
  return children.every((c) => INLINE_TYPES.has(c?.type)) ? parts.join("") : parts.filter(Boolean).join("\n");
}

/** Plain text of a Ricos document — one line per block ("" for none). */
export function richContentToText(rc: Raw | null | undefined): string {
  return ((rc?.nodes ?? []) as Raw[]).map(nodeToText).filter(Boolean).join("\n").trim();
}
