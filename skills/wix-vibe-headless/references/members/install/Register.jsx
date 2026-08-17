// Repair stub for `/register` — NOT part of the shipped route surface.
//
// This vertical has no registration page by design: sign-up is the "Sign up" tab inside the shipped
// LoginForm (see components/LoginForm.jsx), and the routes are `/login`, `/callback`, `/account`.
// Base44, however, seeds its OWN src/pages/Register.jsx (email/password + OTP against base44.auth)
// into every custom-auth-enrolled app at app creation, before any Wix skill runs. deploy.cjs writes
// this file over that leftover so a stale Base44 registration flow can't stay live — a redirect
// rather than a delete, because App.jsx may already route `/register` and a missing import would
// break the build.
//
// Lives outside `app/` on purpose: `app/` is copied into src/ for EVERY members install, and a fresh
// app with no Base44 leftover has no use for this page.
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function Register() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate("/login", { replace: true });
  }, [navigate]);
  return null;
}
