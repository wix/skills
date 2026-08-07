// Credential login/sign-up form — a thin view over useLoginForm (all logic lives in the hook).
// Token-styled; re-skin via theme.css, don't rewrite this JSX. Renders one of three phases the hook
// drives: the email/password form, the 6-digit verification-code entry, or a pending-approval notice.
import { useLoginForm } from "@/hooks/useLoginForm";

const inputStyle = {
  width: "100%", padding: "11px 12px", boxSizing: "border-box", fontSize: 15,
  border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)",
  background: "var(--color-bg)", color: "var(--color-text)",
};
const labelStyle = { display: "block", fontSize: 13, color: "var(--color-muted)", marginBottom: 6 };

export default function LoginForm({ onSuccess }) {
  const f = useLoginForm({ onSuccess });

  if (f.phase === "pending") {
    return <Notice>Your account is awaiting owner approval. You'll be able to sign in once it's approved.</Notice>;
  }

  if (f.phase === "verify") {
    return (
      <form onSubmit={f.submitCode} style={formStyle}>
        <p style={{ color: "var(--color-muted)", margin: 0, lineHeight: 1.5 }}>
          We emailed you a 6-digit code. Enter it to finish.
        </p>
        <div>
          <label style={labelStyle} htmlFor="mf-code">Verification code</label>
          <input id="mf-code" style={inputStyle} inputMode="numeric" autoComplete="one-time-code"
            value={f.code} onChange={(e) => f.setCode(e.target.value)} />
        </div>
        {f.error && <ErrorText>{f.error}</ErrorText>}
        <SubmitButton busy={f.busy}>Verify</SubmitButton>
      </form>
    );
  }

  return (
    <form onSubmit={f.submit} style={formStyle}>
      <div style={{ display: "flex", gap: 8 }}>
        <ModeTab active={f.mode === "login"} onClick={() => f.switchMode("login")}>Sign in</ModeTab>
        <ModeTab active={f.mode === "register"} onClick={() => f.switchMode("register")}>Sign up</ModeTab>
      </div>

      {f.mode === "register" && (
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle} htmlFor="mf-first">First name</label>
            <input id="mf-first" style={inputStyle} value={f.fields.firstName}
              onChange={(e) => f.setField("firstName", e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle} htmlFor="mf-last">Last name</label>
            <input id="mf-last" style={inputStyle} value={f.fields.lastName}
              onChange={(e) => f.setField("lastName", e.target.value)} />
          </div>
        </div>
      )}

      <div>
        <label style={labelStyle} htmlFor="mf-email">Email</label>
        <input id="mf-email" type="email" autoComplete="email" required style={inputStyle}
          value={f.fields.email} onChange={(e) => f.setField("email", e.target.value)} />
      </div>
      <div>
        <label style={labelStyle} htmlFor="mf-pass">Password</label>
        <input id="mf-pass" type="password" required style={inputStyle}
          autoComplete={f.mode === "register" ? "new-password" : "current-password"}
          value={f.fields.password} onChange={(e) => f.setField("password", e.target.value)} />
      </div>

      {f.error && <ErrorText>{f.error}</ErrorText>}
      <SubmitButton busy={f.busy}>{f.mode === "register" ? "Create account" : "Sign in"}</SubmitButton>
    </form>
  );
}

const formStyle = { display: "flex", flexDirection: "column", gap: "var(--space)" };

function ModeTab({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick} style={{
      flex: 1, padding: "8px 0", cursor: "pointer", fontSize: 14, fontWeight: 600,
      background: active ? "var(--color-surface)" : "transparent",
      color: active ? "var(--color-text)" : "var(--color-muted)",
      border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)",
    }}>{children}</button>
  );
}

function SubmitButton({ busy, children }) {
  return (
    <button type="submit" disabled={busy} style={{
      padding: "12px 24px", cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1,
      background: "var(--color-primary)", color: "var(--color-on-primary)",
      border: "none", borderRadius: "var(--radius-sm)", fontSize: 15, fontWeight: 600,
    }}>{busy ? "…" : children}</button>
  );
}

function ErrorText({ children }) {
  return <p role="alert" style={{ color: "var(--color-danger)", margin: 0, fontSize: 14 }}>{children}</p>;
}

function Notice({ children }) {
  return (
    <p style={{
      padding: "var(--space)", background: "var(--color-surface)", color: "var(--color-text)",
      border: "1px solid var(--color-border)", borderRadius: "var(--radius)", lineHeight: 1.5, margin: 0,
    }}>{children}</p>
  );
}
