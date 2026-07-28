/**
 * Dev-only manage banner — a slim banner linking the running app to the Wix
 * Business Manager (the back office) behind it. Renders ONLY in a dev build;
 * production builds (and stacks with no dev flag at all) never show it.
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
  if (document.getElementById("wix-manage-banner")) return;

  // In normal flow as <body>'s first child — pushes the site down rather than
  // floating over it.
  const bar = document.createElement("div");
  bar.id = "wix-manage-banner";
  bar.style.cssText =
    "display:flex;justify-content:center;padding:10px 16px;background:#f4f4f7;" +
    "font-family:system-ui,-apple-system,sans-serif;";

  const card = document.createElement("div");
  card.style.cssText =
    "display:flex;align-items:center;gap:14px;" +
    "background:#fff;color:#131720;border-radius:12px;padding:10px 20px;" +
    "font-size:15px;box-shadow:0 1px 4px rgba(0,0,0,.12);";

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

  // The tooltip is real DOM, not a `title` attribute — native tooltips don't
  // show inside sandboxed preview iframes (e.g. a vibe platform's app preview).
  const TIP_TEXT =
    "This banner only shows while developing. Don't want it? Ask the agent in the chat to remove it.";
  const info = document.createElement("span");
  info.textContent = "ⓘ";
  info.setAttribute("aria-label", TIP_TEXT);
  info.style.cssText =
    "position:relative;color:#868aa5;font-size:16px;cursor:pointer;user-select:none;";
  const tip = document.createElement("span");
  tip.textContent = TIP_TEXT;
  tip.style.cssText =
    "position:absolute;top:calc(100% + 8px);right:-8px;z-index:2147483647;display:none;" +
    "width:240px;background:#131720;color:#fff;font-size:12px;line-height:1.4;" +
    "font-weight:400;border-radius:8px;padding:8px 12px;box-shadow:0 2px 8px rgba(0,0,0,.2);";
  info.append(tip);
  info.addEventListener("mouseenter", () => (tip.style.display = "block"));
  info.addEventListener("mouseleave", () => (tip.style.display = "none"));
  // Touch devices have no hover — a tap toggles instead.
  info.addEventListener("click", () => (tip.style.display = tip.style.display === "block" ? "none" : "block"));

  card.append(text, button, info);
  bar.append(card);
  document.body.prepend(bar);
}
