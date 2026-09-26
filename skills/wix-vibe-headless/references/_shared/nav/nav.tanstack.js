// Navigation adapter — TanStack Start template (src/routes/ file-based routing).
// Copy to src/lib/nav.js. Shipped components import Link/useParams/etc from here so the same
// files run on either Base44 template; this file is the only place the router is named.
//
// Two shapes differ from react-router and are normalised here:
//   useParams  — TanStack scopes params to a route; `strict: false` returns the current match's
//                params, which is what a shared component wants.
//   useNavigate — TanStack takes an object; this returns a function you call with a path, and
//                 `navigate(-1)` still goes back.
import {
  Link as RouterLink,
  Navigate,
  useLocation,
  useNavigate as useRouterNavigate,
  useParams as useRouterParams,
} from "@tanstack/react-router";

// `to` is an already-resolved path (`/blog/my-post`); the router matches it at runtime.
export const Link = RouterLink;
export { Navigate, useLocation };

export function useParams() {
  return useRouterParams({ strict: false });
}

export function useNavigate() {
  const navigate = useRouterNavigate();
  return (to, options) =>
    typeof to === "number" ? window.history.go(to) : navigate({ to, ...options });
}
