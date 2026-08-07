/**
 * Dev-only manage banner — a slim banner linking the running app to the Wix
 * Business Manager (the back office) behind it. Renders ONLY in a dev build;
 * production builds (and stacks with no dev flag at all) never show it. The
 * ✕ button dismisses it persistently (localStorage).
 *
 * Mounted once from the app entry (safe to call unconditionally — it no-ops outside dev).
 * Reads WIX_METASITE_ID from wix-config.js; how/when to mount it lives in the build docs.
 *
 *   import { mountWixManageBanner } from "./rest/wix-manage-banner.js";
 *   mountWixManageBanner();
 *
 * A position:fixed/sticky app header would slide under the banner; it publishes its
 * height as `--wix-manage-banner-height` on :root, so set that header's
 * `top: var(--wix-manage-banner-height, 0px)` (0 in prod / when dismissed).
 */

// The site's metasite id — set it in wix-config.js (alongside WIX_CLIENT_ID), not here.
import { WIX_METASITE_ID } from "./wix-config.js";

const DASHBOARD_URL = `https://manage.wix.com/dashboard/${WIX_METASITE_ID}`;
const DISMISS_KEY = `wix-manage-banner-dismissed-${WIX_METASITE_ID}`;

/**
 * True only in a dev build. `import.meta.env.DEV` is Vite's flag; on bundlers
 * without it this resolves falsy (or throws — caught), so the banner simply
 * never renders. Do not replace this with a runtime heuristic (hostname
 * sniffing etc.) — no flag means no banner.
 */
function isDevBuild() {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
}

export function mountWixManageBanner() {
  if (!isDevBuild()) return;
  if (WIX_METASITE_ID.startsWith("<")) return; // placeholder not filled in
  if (typeof document === "undefined") return;
  try {
    if (window.localStorage.getItem(DISMISS_KEY)) return; // user dismissed it
  } catch {
    /* ignore disabled storage */
  }
  if (document.getElementById("wix-manage-banner")) return;

  // A solid, full-width strip in normal flow as <body>'s first child, so it
  // pushes the whole site down rather than floating over it. A position:fixed
  // (or absolute-over-hero) app header is NOT in normal flow, so it won't be
  // pushed — so this banner publishes its own CURRENTLY-VISIBLE height as the CSS
  // var `--wix-manage-banner-height` on :root: it's the full height at the top and
  // shrinks to 0 as the banner scrolls away. A fixed/sticky header that sets
  // `top: var(--wix-manage-banner-height, 0px)` therefore rides glued to the
  // banner's bottom edge and lands flush at the top once it's scrolled off — no gap.
  const bar = document.createElement("div");
  bar.id = "wix-manage-banner";
  const root = document.documentElement;
  let raf = 0;
  const syncHeight = () => {
    raf = 0;
    const visible = Math.max(0, bar.offsetHeight - window.scrollY);
    root.style.setProperty("--wix-manage-banner-height", `${visible}px`);
  };
  const onScrollOrResize = () => { if (!raf) raf = requestAnimationFrame(syncHeight); };
  bar.style.cssText =
    "position:relative;z-index:2147483647;box-sizing:border-box;display:flex;" +
    "align-items:center;justify-content:center;gap:14px;width:100%;" +
    "padding:12px 48px;background:#fff;color:#131720;font-size:15px;" +
    "font-family:system-ui,-apple-system,sans-serif;border-bottom:1px solid #e2e2ea;";

  const text = document.createElement("span");
  text.append("Manage your business behind this site in Wix ");
  const link = document.createElement("a");
  link.href = DASHBOARD_URL;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = "business manager";
  link.style.cssText = "color:inherit;text-decoration:underline;";
  text.append(link);

  const button = document.createElement("a");
  button.href = DASHBOARD_URL;
  button.target = "_blank";
  button.rel = "noopener";
  button.textContent = "Open";
  button.style.cssText =
    "background:#131720;color:#fff;border-radius:999px;padding:8px 18px;" +
    "font-size:14px;text-decoration:none;";

  const close = document.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "Dismiss banner");
  close.textContent = "✕";
  close.style.cssText =
    "position:absolute;right:12px;top:50%;transform:translateY(-50%);" +
    "background:none;border:none;color:#868aa5;font-size:16px;line-height:1;" +
    "cursor:pointer;padding:6px;";
  close.addEventListener("click", () => {
    bar.remove();
    root.style.setProperty("--wix-manage-banner-height", "0px");
    window.removeEventListener("scroll", onScrollOrResize);
    window.removeEventListener("resize", onScrollOrResize);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore — dismisses for this load only */
    }
  });

  bar.append(text, button, close);
  document.body.prepend(bar);
  syncHeight();                                  // publish height now that it's measurable
  window.addEventListener("scroll", onScrollOrResize, { passive: true });  // shrink the var as it scrolls off
  window.addEventListener("resize", onScrollOrResize); // keep it correct if the bar wraps at narrow widths
}
