// Account page (`/account`) — the member's own profile + log out. Gate it with <RequireAuth> in the
// router (STEP 4) so a visitor is bounced to /login. Reads the member from useMember(); shows the
// identity-only fallback when the Members Area app isn't installed (member is null but loggedIn is
// true — that's setup, not a bug). Token-styled; re-skin via theme.css.
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
    <main style={{ maxWidth: "var(--form-maxw)", margin: "0 auto", padding: "calc(var(--space) * 2) var(--space)" }}>
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center",
        padding: "calc(var(--space) * 1.5)", background: "var(--color-surface)",
        border: "1px solid var(--color-border)", borderRadius: "var(--radius)", boxShadow: "var(--shadow)",
      }}>
        <div style={{
          width: 72, height: 72, borderRadius: "50%", overflow: "hidden",
          background: "var(--color-bg)", border: "1px solid var(--color-border)",
        }}>
          {photo && <img src={photo.startsWith("//") ? `https:${photo}` : photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
        </div>
        <h1 style={{ fontFamily: "var(--font-display)", margin: 0, fontSize: 22 }}>{name}</h1>
        {email && <p style={{ color: "var(--color-muted)", margin: 0 }}>{email}</p>}
        {!member && (
          <p style={{ color: "var(--color-muted)", margin: 0, fontSize: 13, lineHeight: 1.5 }}>
            You're signed in. Install the Wix Members Area app to show profile details here.
          </p>
        )}
        <button type="button" onClick={() => logout()} style={{
          marginTop: 8, padding: "10px 24px", cursor: "pointer", fontSize: 14, fontWeight: 600,
          background: "var(--color-primary)", color: "var(--color-on-primary)",
          border: "none", borderRadius: "var(--radius-sm)",
        }}>Log out</button>
      </div>
    </main>
  );
}
