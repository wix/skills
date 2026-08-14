// useLoginForm — all credential-auth logic, no markup: hold the form fields, run login/register,
// and DRIVE THE STATE MACHINE. register()/login()/verifyEmail() resolve to { state, member?,
// stateToken? }; SUCCESS is only one of the branches. Handling every branch (email verification,
// owner approval) and mapping MemberAuthError to a message is the bug-prone part — keep it verbatim;
// the LoginForm component only renders what this returns. Social/SSO does NOT go through here (it's
// a full-page redirect — see SocialButtons + the /callback page).
import { useState } from "react";
import { login, register, verifyEmail, MemberAuthError } from "@/rest/wix-members-auth";
import { useMember } from "@/context/MemberContext";

export function useLoginForm({ onSuccess } = {}) {
  const { refresh } = useMember();
  const [mode, setMode] = useState("login");        // "login" | "register"
  const [fields, setFields] = useState({ email: "", password: "", firstName: "", lastName: "" });
  // phase drives which UI shows: the form, the 6-digit code entry, or a pending-approval notice.
  const [phase, setPhase] = useState("form");        // "form" | "verify" | "pending"
  const [stateToken, setStateToken] = useState(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const setField = (name, value) => setFields((f) => ({ ...f, [name]: value }));

  // Route a resolved { state } to the right phase. On SUCCESS refresh the member session (so the
  // header/account update) and hand control back to the caller (navigate away).
  async function applyResult(res) {
    if (res.state === "SUCCESS") {
      await refresh();
      onSuccess?.(res.member);
    } else if (res.state === "REQUIRE_EMAIL_VERIFICATION") {
      setStateToken(res.stateToken);
      setPhase("verify");
    } else if (res.state === "REQUIRE_OWNER_APPROVAL") {
      setPhase("pending");
    }
  }

  // Wrap a helper call: clear the error, flip busy, map MemberAuthError to a shown message.
  // emailAlreadyExists on register → bounce the user to the login tab instead of erroring out.
  async function run(fn) {
    setError(null);
    setBusy(true);
    try {
      await applyResult(await fn());
    } catch (e) {
      if (e instanceof MemberAuthError) {
        if (e.code === "emailAlreadyExists") { setMode("login"); setError(e.message); }
        else setError(e.message);
      } else throw e;
    } finally {
      setBusy(false);
    }
  }

  const submit = (e) => {
    e?.preventDefault?.();
    const { email, password, firstName, lastName } = fields;
    if (mode === "register") {
      const profile = (firstName || lastName) ? { firstName, lastName } : undefined;
      return run(() => register(email, password, profile));
    }
    return run(() => login(email, password));
  };

  const submitCode = (e) => {
    e?.preventDefault?.();
    return run(() => verifyEmail(code, stateToken));
  };

  const switchMode = (next) => { setMode(next); setError(null); };

  return {
    mode, switchMode, fields, setField,
    phase, code, setCode,
    error, busy, submit, submitCode,
  };
}
