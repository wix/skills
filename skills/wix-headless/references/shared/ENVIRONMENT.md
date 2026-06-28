# Environment readiness

The rest of this skill assumes a machine that can already run the build: a modern **Node**, **npm**, **git** (with an identity), and an authenticated **Wix CLI**. This file owns getting there — **audit → install (with consent) → authenticate** — across **macOS, Linux, and Windows/PowerShell**. It runs once, early, and is idempotent: re-running it on a ready machine is a no-op that just re-confirms.

Two entry points open this file:

1. **The Discovery pre-flight** (`DISCOVERY.md` § "Pre-flight") runs the audit script before any user-facing question. All green → it proceeds straight to the CLI-auth check. Any gap → it opens this file.
2. **A direct setup request** — *"set up my machine for Wix Headless"*, *"install the Wix CLI"*, *"what do I need to build a headless site"*. Run the full flow below, then hand back to the build flow (or stop, if the user only asked to get set up).

This file **does not scaffold or build** — that's `BUILD.md`. Its job ends when the machine is ready and logged in.

---

## Phase 0 — Detect OS, pick the audit script

```bash
uname -s 2>/dev/null || echo Windows
```

- `Darwin` → macOS, `Linux` → Linux → run **`scripts/audit-env.sh`**.
- Anything else (or the command not found) → Windows → run **`scripts/audit-env.ps1`**.

Both scripts emit the **same** one-line JSON shape, so everything downstream is platform-agnostic.

---

## Phase 1 — Audit (read-only)

Run the matching script with `Bash`. It only probes local tools (no installs, no network), so it's fast and safe.

```bash
# macOS / Linux
bash <SKILL_ROOT>/scripts/audit-env.sh

# Windows — -ExecutionPolicy Bypass avoids a blocked-script error on locked-down machines.
# Prefer pwsh (PowerShell 7+) when present; fall back to powershell (Windows PowerShell 5.1).
powershell -NoProfile -ExecutionPolicy Bypass -File <SKILL_ROOT>\scripts\audit-env.ps1
```

Output (single line):

```json
{"os":"darwin","node":{"present":true,"version":"22.19.0","ok":true},
 "npm":{"present":true,"version":"10.9.3"},
 "git":{"present":true,"version":"2.47.0"},
 "gitIdentity":{"nameSet":true,"emailSet":true},
 "xcodeCLT":{"present":true},"minNode":"20.11.0"}
```

Read it as a checklist. **A requirement is satisfied only when:**

| Field | Ready when | Why it matters |
|---|---|---|
| `node.present` && `node.ok` | Node ≥ **20.11.0** | The `@wix/cli` scaffold + astro toolchain need it. `present:true, ok:false` = installed **but too old** — the dangerous case to eyeball past. |
| `npm.present` | npm resolves | Drives every install + the scaffold. Ships with Node; absent usually means a broken Node install. |
| `git.present` | git resolves | `npm create @wix/new` initializes a repo. |
| `gitIdentity.nameSet` && `gitIdentity.emailSet` | both set | Without them the first commit fails with *"Author identity unknown"*. |
| `xcodeCLT.present` (macOS only; `null` elsewhere) | CLT installed | Provides git + compilers for native npm modules on macOS. |

`wix whoami` (logged-in state) is **not** in this script — it's the existing CLI-auth check in `DISCOVERY.md` § "Pre-flight" / `shared/AUTHENTICATION.md`. Audit covers the toolchain; auth covers the session.

Report a short readiness table to the user, then go to Phase 2 only for the rows that aren't ready.

---

## Phase 2 — Install what's missing (with consent)

For each gap, follow the same loop: **show → consent → run → re-verify.**

1. **Show** the user the exact command for their OS (from the matrix below) and what it does.
2. **Get consent.** Installing system tools mutates their machine — never run an installer without an explicit yes. Multiple gaps: list them together so the user approves once.
3. **Run** it (foreground; installers are interactive and can take minutes).
4. **Re-verify** by re-running the audit script. Trust the JSON, not the installer's exit chatter.

> **The PATH caveat (especially Windows).** A freshly installed tool often isn't on `PATH` until a **new shell** is opened — the current agent shell won't see it. When a post-install re-audit still reports the tool missing, **do not loop on installs**. Tell the user: *"Installed — open a new terminal and tell me to re-check,"* and stop. This is the single most common Windows failure mode (`winget`/nvm-windows both update `PATH` for *future* shells only).

### Install matrix

**Node.js (≥ 20.11.0)** — also delivers npm.

| OS | Preferred | Alternatives |
|---|---|---|
| macOS | `brew install node@20` (or `nvm install 20`) | Installer from nodejs.org |
| Windows | `winget install OpenJS.NodeJS.LTS` | [nvm-windows](https://github.com/coreybutler/nvm-windows) (`nvm install lts`); installer from nodejs.org |
| Linux | `nvm install 20` (recommended) | distro: `sudo apt-get install -y nodejs npm` — but distro Node is often **too old**; prefer nvm or [NodeSource](https://github.com/nodesource/distributions) |

After install, confirm with the audit script (checks the version gate too), not just `node -v` by eye.

**Git**

| OS | Command |
|---|---|
| macOS | `xcode-select --install` (also installs the CLT), or `brew install git` |
| Windows | `winget install Git.Git`, or the installer from git-scm.com |
| Linux | `sudo apt-get install -y git` (or the distro equivalent — `dnf`, `pacman`, …) |

**Git identity** (OS-agnostic; only if `nameSet`/`emailSet` is false) — ask the user for their name + email, then:

```bash
git config --global user.name  "Their Name"
git config --global user.email "their@email.com"
```

**macOS Command Line Tools** (only if `xcodeCLT.present` is false): `xcode-select --install` (opens a GUI installer — the user clicks through; wait for them, then re-audit).

**Wix CLI** — **nothing to install.** The skill always invokes it as `npx @wix/cli@latest …`, which fetches a project-local copy on first use (~3–5 s). Do not `npm i -g @wix/cli`. Authentication is Phase 3.

### Windows / PowerShell gotchas

The roughest surface — handle these explicitly:

- **`winget` missing.** Comes with App Installer on Windows 10 1709+ / 11; older or stripped images lack it. If `winget` isn't found, fall back to nvm-windows or the nodejs.org / git-scm.com installers rather than retrying `winget`.
- **PATH needs a new shell.** See the caveat above — the #1 cause of "I installed it but you still say it's missing."
- **Script execution policy.** Always launch the audit via `-ExecutionPolicy Bypass` (as shown). Don't tell the user to weaken their machine-wide policy.
- **`pwsh` vs `powershell`.** PowerShell 7+ (`pwsh`) and Windows PowerShell 5.1 (`powershell`) both run the audit. Prefer `pwsh` when present.
- **Avoid Git Bash / WSL assumptions.** Detect the real shell (Phase 0) and use the PowerShell path on Windows; don't assume a bash-compatible environment exists.

---

## Phase 3 — Authenticate

Once the toolchain is ready, ensure an authenticated CLI session. **Do not re-implement the login flow here** — it's owned by [`shared/AUTHENTICATION.md`](./AUTHENTICATION.md):

```bash
npx @wix/cli@latest whoami >/dev/null 2>&1   # exit 0 = logged in
```

Non-zero → run the agent-driven `npx @wix/cli@latest login` flow (background run, parse the `awaiting_user` event, surface URL + code in plain prose, wait for completion) exactly as `shared/AUTHENTICATION.md` § "`wix login` from a non-interactive agent" documents. The Discovery pre-flight already runs this check; this phase only matters when the user invoked setup directly.

---

## Phase 4 — Ready

Confirm a final all-green audit + `whoami` exit 0, then summarize what's installed and that they're logged in. Hand back to the build flow:

- Opened from the **Discovery pre-flight** → return; Discovery continues from where it paused.
- Opened from a **direct setup request** that also wants a site built → continue into the normal run (open `PLAN.md`).
- Opened from a **setup-only request** → stop here; the machine is ready for a future build.
