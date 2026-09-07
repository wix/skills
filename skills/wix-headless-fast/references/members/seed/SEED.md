# Members — seeding

**Members self-register — there is no member content to seed.** The Wix login page registers
or logs in members at runtime; creating members at build time is intentionally out of scope
(a headless run must never stall on an interactive login, and Create Member needs an
elevated credential).

What `seed-members.mjs` does is the one build-time setup the vertical needs: **install the
Wix Members Area app** — the *profile* layer. Identity (log in / log out / "logged-in vs
not" gating) needs no install; profile data does: without the app, `getCurrentMember()`
returns nothing for a logged-in member and the account page can't render who they are.

```bash
# from the project root (where wix.config.json lives) — the plan file is optional:
node <SKILL_ROOT>/references/members/seed/seed-members.mjs
```

```json
{ "installMembersArea": true }
```

- `installMembersArea` — default `true`; set `false` only when the run needs pure
  "logged-in vs not" gating and will never display member data.
- Re-running is safe: an already-installed app is recorded in the result JSON
  (`membersAreaInstall.note`), never thrown.

**Seeding is additive — never delete or overwrite existing content**; ask first if a cleanup
seems needed.

## Escape hatch — individual functions
`setupMembers` composes the exported steps — `installMembersAreaApp`, plus `makeCtx()` —
import them for a partial re-run.

## Reference
The appDefId and the identity/profile split come from
`wix-headless/references/SETUP.md` (§ members). Signup security (email verification, owner
approval, reCAPTCHA) is dashboard-governed — never seeded. If a run's prompt explicitly needs
a pre-created member (rare), the admin Create Member shape is in the live Wix API reference —
read it via the `wix-docs` skill; don't guess it here.
