// Navigation adapter — React Router template (src/App.jsx + react-router-dom).
// Shipped components import Link/useParams/etc from "@/lib/nav" so the same files run on either
// Base44 template; this file is the only place the router is named.
//
// It rides in the deployed tree, so every install path lands it — including the ones that copy
// `shared/app/` directly instead of running install/deploy.cjs. On the TanStack Start template
// (src/routes/__root.jsx present) `_shared/nav/nav.tanstack.js` replaces it; deploy.cjs does that
// swap on its own. See `_shared/routing.md`.
export { Link, useParams, useNavigate, useLocation, Navigate } from "react-router-dom";
