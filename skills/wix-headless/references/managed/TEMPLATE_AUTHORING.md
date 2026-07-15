# Template Authoring — building a *contributable template* with this skill

Read this file when the deliverable is a **contributable template** — a reusable, maintained, managed-Astro CLI template (for the Wix templates repo) — rather than an ad-hoc site. It is an **overlay on the normal managed flow**, not a replacement: the run still rides `CREATE.md` (new template) or `CONNECT.md`-as-iterate (extending one), with Discovery → Setup → Seed → build → release unchanged.

**Scope:** Wix-managed Astro CLI only (`@wix/cli` + `@wix/astro`). Self-managed, Next.js, and React Native templates are out of scope.

The file has three parts, matching how each relates to the rest of the skill:

1. **The standing brief** — intent choices the template product has already made. The skill's intent-conditionals ("only when the brief asks…") consume these; stating them here *is* the brief.
2. **House style** — requirements where the skill is deliberately silent (structure, code standards, testing, docs), because an ad-hoc site doesn't need them and a maintained template does.
3. **Platform facts & mechanics** — nothing restated; a pointer table into the canonical references. If anything here ever seems to conflict with those, the canonical reference wins.

---

## 1 — The standing brief (intent, pre-resolved)

These are the template product's choices. Where the skill's references branch on intent, resolve the branch with these — no need to ask.

- **Login is custom-branded.** A template ships its **own login / sign-up UI** — treat this as the brief explicitly asking for custom login and build it per `../inline-recipes/how-to-code-members-custom-login.md`. The Wix-hosted login page is **not** used in templates (a template's auth pages are part of the design deliverable). Dashboard prerequisites: allow-list the exact callback URIs on the OAuth app, and set the OAuth app **Login URL** to the template's login page — business flows (e.g. checkout) use it to redirect unauthenticated visitors.
- **Scaffold blank.** Bare `--site-template` (the blank starter) — same as the skill's normal create path. The template's design is authored, never adopted from a business starter.
- **Verification is asked for.** The skill's "don't smoke-test unless the user asks to verify" conditional is resolved for template runs: the template's golden path **must pass its tests** (§2.3) before it is contributed. Release rules are unchanged (release once, at the very end).

## 2 — House style (where the skill is silent by design)

### 2.1 Project structure

Every template lives at `astro/<template-name>/` in the templates repo and must contain:

```
astro/<template-name>/
├── .gitignore
├── .npmrc
├── .template-config.json        # Wix CLI template config (required)
├── README.md                    # required sections: §2.4
├── astro.config.mjs             # per astro.md Caveat A2 — do not diverge
├── package.json                 # scripts: dev → wix dev, build → wix build, release → wix release
├── tsconfig.json                # strict: true
├── tailwind.config.mjs
├── src/
│   ├── components/              # UI components, co-located with feature area
│   ├── pages/
│   │   ├── index.astro          # home page
│   │   └── api/                 # server-only API routes (elevation, backend logic)
│   └── integrations/            # Wix vertical modules: service.ts + types.ts per vertical
└── public/
```

- **TypeScript required**, `strict: true`. No `.js` source files in new templates.
- **Tailwind CSS required.** No CSS modules, no inline styles.
- **No `.env.template`** — the CLI manages `WIX_CLIENT_*`; custom vars only, per the env-var mechanism (`astro.md` §5).

### 2.2 Code standards

- No `any` without an explanatory comment.
- No `console.log` in committed code.
- No hardcoded Wix App IDs without a comment saying what they identify.
- **Keep pages thin.** Wix calls live in `src/integrations/<vertical>/service.ts` with typed exports; `.astro` pages consume the services. (SSR guards per `astro.md` A3 apply inside the services and any remaining frontmatter calls alike.)

### 2.3 Testing (ad-hoc runs skip this — template runs must not)

- **Vitest** unit tests for integration service files: `src/integrations/**/*.test.ts`.
- **Playwright** e2e for the template's golden-path flow(s).
- `data-testid` on every interactive element; centralize the IDs in `src/utils/test-ids.ts`.
- Screenshot baselines where applicable.

### 2.4 Documentation

Every template's `README.md` is **its own distinct content** — never copied from another template — with:

1. Template name + one-line description
2. Live demo URL (Wix-hosted — required)
3. Features list (which Wix verticals are used)
4. Prerequisites: Node ≥ 20.11, Wix account
5. Quick start: `git clone` → `npm install --ignore-scripts` → `wix dev`
6. What to configure in the Wix dashboard (installed apps, content seeding)
7. How to release: `wix build && wix release`

## 3 — Platform facts & mechanics: reference, don't restate

Everything below is owned by the canonical references — read them there; this file deliberately carries none of it, so it can't drift.

| Concern | Canonical reference |
|---|---|
| Scaffold / link / init (`npm create @wix/new@latest -- headless …`) | `../astro.md` §1 |
| Required `astro.config.mjs` (`wix()` + `wixPages()` + `react()`, `output: 'server'`, `checkOrigin: false`) | `../astro.md` Caveat **A2** |
| Auth model (auto-auth, no client) · custom login flow | `../astro.md` §2 · `../inline-recipes/how-to-code-members-custom-login.md` |
| Custom env vars (`envField` schema, `astro:env/*`, `wix env set`/`pull`) | `../astro.md` §5 |
| SEO — main pages (automatic) · item/detail pages (coded) | `../astro.md` §6 + the vertical's `../inline-recipes/how-to-code-*.md` |
| Wix media / rich text (`wix:image://` resolution, Ricos) | `../astro.md` Caveat **A6** |
| SSR error guards · island hydration · no HTML comments in frontmatter | Caveats **A3 / A4 / A5** |
| Dependency install (`npm install --ignore-scripts`; sharp is a non-issue) | Caveat **A9** |
| Dev / build / release workflow (release once, at the end) | `../astro.md` §4 · `DEPLOYMENT.md` |
| Backend setup & content seeding | `../SETUP.md` · `../SEED.md` |
