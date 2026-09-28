// REFERENCE account surface: profile card + log-out on the @theme tokens. Correct and
// complete; per the skill's model you design your own on useMember. On Astro the page
// passes the SSR-resolved member as initialMember; a SPA mounts it inside <RequireAuth>.
import { useMember } from "../../hooks/members/useMember";
import type { CurrentMember } from "../../wix/members/types";

export interface AccountViewProps {
  initialMember?: CurrentMember | null;
}

export default function AccountView({ initialMember }: AccountViewProps) {
  const { member, loggedIn, loading, error, logout } = useMember({ initialMember });

  if (loading) {
    return (
      <div className="mx-auto max-w-md" aria-busy="true">
        <div className="h-40 animate-pulse rounded-lg bg-secondary" />
      </div>
    );
  }

  if (!loggedIn) {
    return <p className="py-16 text-center text-muted-foreground">You're logged out.</p>;
  }

  return (
    <div className="mx-auto max-w-md rounded-lg border border-border p-8">
      <div className="flex items-center gap-4">
        {member?.photoUrl ? (
          <img src={member.photoUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
        ) : (
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary text-xl font-semibold">
            {(member?.displayName ?? "M").slice(0, 1).toUpperCase()}
          </span>
        )}
        <div>
          <p className="text-lg font-semibold text-foreground">{member?.displayName ?? "Member"}</p>
          {member?.loginEmail && <p className="text-sm text-muted-foreground">{member.loginEmail}</p>}
          {member?.memberSince && (
            <p className="mt-0.5 text-xs text-muted-foreground">Member since {member.memberSince}</p>
          )}
        </div>
      </div>
      {!member && (
        <p className="mt-4 text-sm text-muted-foreground">
          Logged in, but profile details are unavailable — the Wix Members Area app isn't installed
          on this site.
        </p>
      )}
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      <button
        type="button"
        onClick={() => void logout()}
        className="mt-6 rounded-full border border-border px-5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
      >
        Log out
      </button>
    </div>
  );
}
