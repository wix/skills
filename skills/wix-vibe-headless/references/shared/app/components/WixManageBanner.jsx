// Dev-only banner linking the running app to its Wix Business Manager (the back office).
// Renders ONLY in a dev build (never in production) and is dismissible (persisted per site).
// Mount it at the top of your Layout's fixed region, ABOVE <Header/> (see INSTRUCTIONS STEP 4) —
// banner + header ride together as one fixed block, so nothing drifts or gaps on scroll.
import { useState } from "react";
import { WIX_METASITE_ID } from "@/rest/wix-config";

const DASHBOARD_URL = `https://manage.wix.com/dashboard/${WIX_METASITE_ID}`;
const DISMISS_KEY = `wix-manage-banner-dismissed-${WIX_METASITE_ID}`;
const IS_DEV = (() => { try { return Boolean(import.meta.env?.DEV); } catch { return false; } })();

export default function WixManageBanner() {
  const [dismissed, setDismissed] = useState(() => {
    try { return Boolean(window.localStorage.getItem(DISMISS_KEY)); } catch { return false; }
  });
  // No flag → no banner. Never renders in prod, once dismissed, or before the id is filled in.
  if (!IS_DEV || dismissed || WIX_METASITE_ID.startsWith("<")) return null;

  const dismiss = () => {
    setDismissed(true);
    try { window.localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore disabled storage */ }
  };

  return (
    <div style={{
      position: "relative", display: "flex", alignItems: "center", justifyContent: "center", gap: 14,
      width: "100%", padding: "12px 48px", boxSizing: "border-box",
      background: "#fff", color: "#131720", fontSize: 15,
      fontFamily: "system-ui,-apple-system,sans-serif", borderBottom: "1px solid #e2e2ea",
    }}>
      <span>
        Manage your business behind this site in Wix{" "}
        <a href={DASHBOARD_URL} target="_blank" rel="noopener" style={{ color: "inherit", textDecoration: "underline" }}>business manager</a>
      </span>
      <a href={DASHBOARD_URL} target="_blank" rel="noopener" style={{
        background: "#131720", color: "#fff", borderRadius: 999, padding: "8px 18px", fontSize: 14, textDecoration: "none",
      }}>Open</a>
      <button type="button" aria-label="Dismiss banner" onClick={dismiss} style={{
        position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
        background: "none", border: "none", color: "#868aa5", fontSize: 16, lineHeight: 1, cursor: "pointer", padding: 6,
      }}>✕</button>
    </div>
  );
}
