# Lifecycle Log Contract

Observability log for the entire site-building flow. Unlike `features.log.md` (a verification contract the orchestrator reads to make decisions), the lifecycle log is **observational only** — no skill reads it to make decisions. It exists for post-run evaluation: regression detection, root cause analysis, and skill improvement.

## Log Location

`.wix/lifecycle.log.md` in the project root (next to `package.json`).

Created by the **CLI skill** after scaffolding. For standalone feature additions (no prior scaffolding), the **orchestrator** creates it if it doesn't exist.

Always append — never overwrite previous runs.

## Structure

Each run starts with a header, followed by phase entries in execution order:

```markdown
# Lifecycle Log

## Run: {ISO timestamp}
- Site: {brand name}
- Type: {business type}
- Plan: {apps/features, comma-separated}

### {phase-name}
- Started: {ISO timestamp}
- {phase-specific fields}
- Ended: {ISO timestamp}
```

Use ISO 8601 timestamps — run `date -u +%Y-%m-%dT%H:%M:%SZ` to get the current time.

## Phase Formats

### solution-architect

Logged by the **CLI skill** from the functional plan context:

```markdown
### solution-architect
- Business: {type} — {brief description}
- Brand: {name}
- Apps: {comma-separated}
- CMS collections: {name (key fields), ...} | none
- Pages: {count} ({page names})
```

No timestamps — the architect's work is conversational and hard to bound precisely.

### cli

```markdown
### cli
- Started: {timestamp}
- Command: {scaffold command used}
- Result: scaffolded | failed ({error code})
- Project: {directory path}
- Business ID: {id from JSON output}
- Ended: {timestamp}
```

### designer

```markdown
### designer
- Started: {timestamp}
- Direction: {1-line aesthetic summary}
- Pages designed: {count} ({names})
- Components: {count} ({names})
- Decorative images: {n} generated | skipped | not attempted
- Ended: {timestamp}
```

### features-orchestrator (header)

```markdown
### features-orchestrator
- Started: {timestamp}
- Skills planned: {comma-separated}
```

### Feature skill sub-entries

Each feature skill appends a `####` entry under the orchestrator:

```markdown
#### {skill-name}
- Started: {timestamp}
- Content: {what was created, with counts}
- Images: {status — mirrors the features.log.md entry}
- Status: complete | partial | failed
- Ended: {timestamp}
```

Optional fields (encouraged — most useful for debugging):
- `MCP calls: {count} ({breakdown})` — e.g., `3 (createProduct x3)`
- `MCP failures: {count} ({details})`
- `Retries: {count}`

### verification

Written by the orchestrator after reading `features.log.md`:

```markdown
### verification
- All skills logged: yes | no (missing: {list})
- Image gaps: none | {skills with "not attempted"}
- Hard stops: {count}
```

### build

Written by the orchestrator after install, build, and preview/release:

```markdown
### build
- npm install: success | failed ({duration}s)
- Build: success | failed ({duration}s)
- Preview: success | failed
- URL: {preview URL}
- Ended: {timestamp}
```

### summary

Final entry in every run:

```markdown
### summary
- Total: {Xm Ys} (first phase start to build end)
- Features: {count} skills ({names})
- Images: {generated} generated, {skipped} skipped, {na} n/a
```

## Rules

1. **Observational only** — no skill reads this log to make decisions
2. The CLI skill creates the file; the orchestrator creates it for standalone invocations
3. Always append — never overwrite previous runs
4. Feature skill sub-entries use `####` (one level below the orchestrator's `###`)
5. Extra fields beyond the format above are allowed and encouraged
6. If a phase is skipped (e.g., standalone mode), omit its entry
7. The `summary` section is the last entry in every run

## Complete Example

A restaurant site with forms and three CMS collections:

```markdown
# Lifecycle Log

## Run: 2026-03-15T14:32:00Z
- Site: Trattoria Nonna
- Type: Restaurant
- Plan: forms, @wix/data (MenuItems, TeamMembers, FAQ)

### solution-architect
- Business: Restaurant — Italian family restaurant in downtown
- Brand: Trattoria Nonna
- Apps: forms, @wix/data
- CMS collections: MenuItems (name, description, price, category, photo), TeamMembers (name, role, bio, photo), FAQ (question, answer, sortOrder)
- Pages: 6 (home, about, menu, team, faq, contact)

### cli
- Started: 2026-03-15T14:35:20Z
- Command: npx @wix/create-headless --json --business-name "Trattoria Nonna" --project-name "trattorianonna" --apps forms
- Result: scaffolded
- Project: ./trattorianonna
- Business ID: abc-123-def
- Ended: 2026-03-15T14:36:45Z

### designer
- Started: 2026-03-15T14:36:45Z
- Direction: Warm Italian editorial — cream/terracotta palette, Playfair Display headings, rustic textures
- Pages designed: 6 (home, about, menu, team, faq, contact)
- Components: 14 (Navigation, Footer, Hero, MenuCard, MenuGrid, TeamCard, TeamGrid, FaqAccordion, ContactForm, Section, FeatureCard, TestimonialCard, AboutSection, LocationMap)
- Decorative images: 3 generated
- Ended: 2026-03-15T14:48:10Z

### features-orchestrator
- Started: 2026-03-15T14:48:10Z
- Skills planned: forms, cms/MenuItems, cms/TeamMembers, cms/FAQ

#### forms
- Started: 2026-03-15T14:48:15Z
- Content: "Reservation Request" form (4 fields: first_name, email, phone, message)
- Images: not applicable
- MCP calls: 2 (createForm, listForms)
- MCP failures: 0
- Status: complete
- Ended: 2026-03-15T14:49:30Z

#### cms/MenuItems
- Started: 2026-03-15T14:49:30Z
- Content: 12 menu items created
- Images: skipped (menu dish photos can be added via dashboard)
- MCP calls: 14 (createCollection, insertDataItem x12, listCollections)
- MCP failures: 0
- Status: complete
- Ended: 2026-03-15T14:52:00Z

#### cms/TeamMembers
- Started: 2026-03-15T14:52:00Z
- Content: 4 team members created (Marco, Sofia, Luca, Elena)
- Images: generated (4/4 attached)
- MCP calls: 6 (createCollection, insertDataItem x4, listCollections)
- MCP failures: 0
- Status: complete
- Ended: 2026-03-15T14:55:45Z

#### cms/FAQ
- Started: 2026-03-15T14:55:45Z
- Content: 8 FAQ items created
- Images: not applicable
- MCP calls: 10 (createCollection, insertDataItem x8, listCollections)
- MCP failures: 0
- Status: complete
- Ended: 2026-03-15T14:56:30Z

### verification
- All skills logged: yes
- Image gaps: none
- Hard stops: 0

### build
- npm install: success (28s)
- Build: success (12s)
- Preview: success
- URL: https://trattorianonna-abc123.wixstudio.io
- Ended: 2026-03-15T14:58:15Z

### summary
- Total: 26m 15s
- Features: 4 skills (forms, cms/MenuItems, cms/TeamMembers, cms/FAQ)
- Images: 4 generated, 12 skipped, 8 n/a
```
