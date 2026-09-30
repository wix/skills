// The gate for plan-holders-only content — wire as-is around anything a plan unlocks. It owns the
// rules a paywall gets wrong when rewritten: nothing gated renders while the session or the orders
// read is unsettled; a visitor gets the way in (log in, with a return to this page); a member
// without an active order for one of the plans gets the way to the plans; a failed read keeps the
// content closed and shows the message. Access itself is usePlanAccess → hasActiveOrderFor: an
// ACTIVE order for one of `planIds`, nothing here decides that.
//
// The session comes from the `members` vertical (its useMember()) — pass it in; this vertical does
// not ship it. Routing-free: plain <a> links, both hrefs overridable. Client-side only (the
// session is a browser cookie) — mount it client:only="react" on Astro, like members' RequireAuth.
import type { ReactNode } from "react";
import { usePlanAccess, type PlanAccessSession, type UsePlanAccessOptions } from "../../hooks/pricing-plans/usePlanAccess";

export interface RequirePlanProps extends UsePlanAccessOptions {
  /** The plans that unlock the content (any one of them). */
  planIds: string[];
  /** The members session: `useMember()` from the members vertical. */
  session: PlanAccessSession;
  children: ReactNode;
  /** Where a visitor logs in; `{returnTo}` is replaced with the current path. */
  loginHref?: string;
  /** Where a member without a plan goes to get one. */
  plansHref?: string;
  /** Rendered for a member without an active plan instead of the default prompt. */
  fallback?: ReactNode;
}

export default function RequirePlan({
  planIds,
  session,
  children,
  loginHref = "/login?returnTo={returnTo}",
  plansHref = "/plans",
  fallback,
  ...options
}: RequirePlanProps) {
  const { hasAccess, loading, error } = usePlanAccess(planIds, session, options);

  if (loading) {
    return (
      <div className="py-16 text-center text-muted-foreground" aria-busy="true">
        Loading…
      </div>
    );
  }

  if (hasAccess) return <>{children}</>;

  if (error) {
    return (
      <p className="py-8 text-center text-sm text-destructive" role="alert">
        {error}
      </p>
    );
  }

  if (!session.loggedIn) {
    const returnTo = typeof window !== "undefined" ? window.location.pathname : "/";
    return (
      <div className="mx-auto max-w-md rounded-lg border border-border p-8 text-center">
        <p className="text-sm text-muted-foreground">This content is for plan members. Log in to continue.</p>
        <a
          href={loginHref.replace("{returnTo}", encodeURIComponent(returnTo))}
          className="mt-4 inline-block rounded-control bg-primary px-5 py-2 text-sm font-medium text-primary-foreground no-underline transition-opacity hover:opacity-90"
        >
          Log in / Sign up
        </a>
      </div>
    );
  }

  return (
    <>
      {fallback ?? (
        <div className="mx-auto max-w-md rounded-lg border border-border p-8 text-center">
          <p className="text-sm text-muted-foreground">This content is included with a plan you don't have yet.</p>
          <a
            href={plansHref}
            className="mt-4 inline-block rounded-control bg-primary px-5 py-2 text-sm font-medium text-primary-foreground no-underline transition-opacity hover:opacity-90"
          >
            See plans
          </a>
        </div>
      )}
    </>
  );
}
