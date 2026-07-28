/**
 * Dev-only manage banner — a slim banner linking the running app to the Wix
 * Business Manager (the back office) behind it. Renders ONLY in a dev build;
 * production builds (and stacks with no dev flag at all) never show it. The
 * ✕ button dismisses it persistently (localStorage).
 *
 * Copy next to wix-client.js, set WIX_METASITE_ID, and mount once from the
 * app entry (safe to call unconditionally — it no-ops outside dev):
 *
 *   import { mountWixManageBanner } from "./rest/wix-manage-banner.js";
 *   mountWixManageBanner();
 */

/** The site's metasite id (from the same prompt that carried WIX_CLIENT_ID). */
export const WIX_METASITE_ID = "<YOUR-METASITE-ID>";

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
  // pushes the whole site down rather than floating over it. CAUTION: an app
  // header that is position:fixed (or absolute over a hero) is NOT in normal
  // flow and will NOT be pushed — it slides under the banner. If the app has
  // one, offset it by this element's offsetHeight; verify visually.
  const bar = document.createElement("div");
  bar.id = "wix-manage-banner";
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
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore — dismisses for this load only */
    }
  });

  bar.append(text, button, close);
  document.body.prepend(bar);
}
