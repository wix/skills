// Credential login/sign-up form — a thin view over useLoginForm (all logic lives in the hook).
// Styled with base44 design tokens (shadcn Tailwind classes); don't rewrite this JSX. Renders one of
// three phases the hook drives: the email/password form, the 6-digit verification-code entry, or a
// pending-approval notice.
import { useLoginForm } from "@/hooks/useLoginForm";

const inputCls =
  "w-full py-[11px] px-3 box-border text-[15px] border border-input rounded-sm bg-background text-foreground";
const labelCls = "block text-[13px] text-muted-foreground mb-1.5";

export default function LoginForm({ onSuccess }) {
  const f = useLoginForm({ onSuccess });

  if (f.phase === "pending") {
    return <Notice>Your account is awaiting owner approval. You'll be able to sign in once it's approved.</Notice>;
  }

  if (f.phase === "verify") {
    return (
      <form onSubmit={f.submitCode} className={formCls}>
        <p className="text-muted-foreground m-0 leading-normal">
          We emailed you a 6-digit code. Enter it to finish.
        </p>
        <div>
          <label className={labelCls} htmlFor="mf-code">Verification code</label>
          <input id="mf-code" className={inputCls} inputMode="numeric" autoComplete="one-time-code"
            value={f.code} onChange={(e) => f.setCode(e.target.value)} />
        </div>
        {f.error && <ErrorText>{f.error}</ErrorText>}
        <SubmitButton busy={f.busy}>Verify</SubmitButton>
      </form>
    );
  }

  return (
    <form onSubmit={f.submit} className={formCls}>
      <div className="flex gap-2">
        <ModeTab active={f.mode === "login"} onClick={() => f.switchMode("login")}>Sign in</ModeTab>
        <ModeTab active={f.mode === "register"} onClick={() => f.switchMode("register")}>Sign up</ModeTab>
      </div>

      {f.mode === "register" && (
        <div className="flex gap-3">
          <div className="flex-1">
            <label className={labelCls} htmlFor="mf-first">First name</label>
            <input id="mf-first" className={inputCls} value={f.fields.firstName}
              onChange={(e) => f.setField("firstName", e.target.value)} />
          </div>
          <div className="flex-1">
            <label className={labelCls} htmlFor="mf-last">Last name</label>
            <input id="mf-last" className={inputCls} value={f.fields.lastName}
              onChange={(e) => f.setField("lastName", e.target.value)} />
          </div>
        </div>
      )}

      <div>
        <label className={labelCls} htmlFor="mf-email">Email</label>
        <input id="mf-email" type="email" autoComplete="email" required className={inputCls}
          value={f.fields.email} onChange={(e) => f.setField("email", e.target.value)} />
      </div>
      <div>
        <label className={labelCls} htmlFor="mf-pass">Password</label>
        <input id="mf-pass" type="password" required className={inputCls}
          autoComplete={f.mode === "register" ? "new-password" : "current-password"}
          value={f.fields.password} onChange={(e) => f.setField("password", e.target.value)} />
      </div>

      {f.error && <ErrorText>{f.error}</ErrorText>}
      <SubmitButton busy={f.busy}>{f.mode === "register" ? "Create account" : "Sign in"}</SubmitButton>
    </form>
  );
}

const formCls = "flex flex-col gap-4";

function ModeTab({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex-1 py-2 px-0 cursor-pointer text-sm font-semibold border border-border rounded-sm ${active ? "bg-card text-foreground" : "bg-transparent text-muted-foreground"}`}
    >{children}</button>
  );
}

function SubmitButton({ busy, children }) {
  return (
    <button type="submit" disabled={busy}
      className="px-6 py-3 cursor-pointer bg-primary text-primary-foreground border-none rounded-sm text-[15px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
    >{busy ? "…" : children}</button>
  );
}

function ErrorText({ children }) {
  return <p role="alert" className="text-destructive m-0 text-sm">{children}</p>;
}

function Notice({ children }) {
  return (
    <p className="p-4 bg-card text-foreground border border-border rounded-lg leading-normal m-0">{children}</p>
  );
}
