// Account page (`/account`) — the member's own profile + log out. Gate it with <RequireAuth> in the
// router (STEP 4) so a visitor is bounced to /login. Reads the member from useMember(); shows the
// identity-only fallback when the Members Area app isn't installed (member is null but loggedIn is
// true — that's setup, not a bug). Styled with base44 design tokens (shadcn Tailwind classes).
import { useMember } from "@/context/MemberContext";

export default function Account() {
  const { member, logout } = useMember();

  const name = member?.profile?.nickname
    || [member?.contact?.firstName, member?.contact?.lastName].filter(Boolean).join(" ")
    || member?.loginEmail
    || "Member";
  const email = member?.loginEmail;
  const photo = member?.profile?.photo?.url;

  return (
    <main className="max-w-[420px] mx-auto py-8 px-4">
      <div className="flex flex-col items-center gap-3 text-center p-6 bg-card border border-border rounded-lg shadow-sm">
        <div className="w-[72px] h-[72px] rounded-full overflow-hidden bg-background border border-border">
          {photo && <img src={photo.startsWith("//") ? `https:${photo}` : photo} alt="" className="w-full h-full object-cover" />}
        </div>
        <h1 className="font-display m-0 text-[22px]">{name}</h1>
        {email && <p className="text-muted-foreground m-0">{email}</p>}
        {!member && (
          <p className="text-muted-foreground m-0 text-[13px] leading-normal">
            You're signed in. Install the Wix Members Area app to show profile details here.
          </p>
        )}
        <button type="button" onClick={() => logout()}
          className="mt-2 py-2.5 px-6 cursor-pointer text-sm font-semibold bg-primary text-primary-foreground border-none rounded-sm"
        >Log out</button>
      </div>
    </main>
  );
}
