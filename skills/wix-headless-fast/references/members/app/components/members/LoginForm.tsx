// Shipped custom login form. The member stays on this site: credential calls exchange
// directly into member tokens; only logout leaves the app.
import { FormEvent, useState } from "react";
import { useMember } from "../../hooks/members/useMember";

export interface LoginFormProps {
  onSuccess?: () => void;
}

export default function LoginForm({ onSuccess }: LoginFormProps) {
  const { login, register, verifyEmail, error } = useMember();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [code, setCode] = useState("");
  const [verification, setVerification] = useState(false);
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);

  function done() {
    if (onSuccess) return onSuccess();
    const returnTo = new URLSearchParams(window.location.search).get(
      "returnTo",
    );
    window.location.assign(returnTo?.startsWith("/") ? returnTo : "/account");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result =
        mode === "login"
          ? await login(email, password)
          : await register(email, password, { firstName, lastName });
      if (result.state === "SUCCESS") done();
      if (result.state === "EMAIL_VERIFICATION_REQUIRED") setVerification(true);
      if (result.state === "OWNER_APPROVAL_REQUIRED") setPending(true);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await verifyEmail(code);
      if (result.state === "SUCCESS") done();
      if (result.state === "OWNER_APPROVAL_REQUIRED") setPending(true);
    } finally {
      setBusy(false);
    }
  }

  if (pending)
    return (
      <p className="rounded-lg border border-border p-4 text-sm">
        Your account is awaiting approval.
      </p>
    );
  if (verification) {
    return (
      <form onSubmit={submitCode} className="space-y-4">
        <label className="block text-sm">
          Verification code
          <input
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className="mt-1 w-full rounded border border-border bg-background p-2"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          disabled={busy}
          className="rounded bg-primary px-4 py-2 text-primary-foreground"
        >
          {busy ? "Verifying…" : "Verify"}
        </button>
      </form>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode("login")}
          className="text-sm underline"
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => setMode("register")}
          className="text-sm underline"
        >
          Sign up
        </button>
      </div>
      {mode === "register" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            First name
            <input
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              className="mt-1 w-full rounded border border-border bg-background p-2"
            />
          </label>
          <label className="text-sm">
            Last name
            <input
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              className="mt-1 w-full rounded border border-border bg-background p-2"
            />
          </label>
        </div>
      )}
      <label className="block text-sm">
        Email
        <input
          required
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-1 w-full rounded border border-border bg-background p-2"
        />
      </label>
      <label className="block text-sm">
        Password
        <input
          required
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-1 w-full rounded border border-border bg-background p-2"
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        disabled={busy}
        className="rounded bg-primary px-4 py-2 text-primary-foreground"
      >
        {busy ? "Working…" : mode === "login" ? "Sign in" : "Create account"}
      </button>
    </form>
  );
}
