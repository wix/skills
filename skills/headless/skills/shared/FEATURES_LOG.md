# Features Log Contract

Every content-producing skill writes a log entry to `.wix/features.log.md` (in the project root) before returning to the orchestrator. The orchestrator reads this log during its Shared Ending phase to verify completeness.

## Log Location

`.wix/features.log.md` in the project root (next to `package.json`).

Create the file with a `# Features Log` header if it doesn't exist. Append to it if it does — never overwrite previous entries.

## Format

Each skill appends a section:

```markdown
## {skill-name}
- Status: complete | partial | failed
- Content: {what was created, with counts and names}
- Images: generated ({n}/{total} attached) | skipped ({reason}) | not applicable | not attempted
- Image field: {field name}
```

The `Image field` line is **CMS only** — CMS collections have variable image field names (`photo`, `coverImage`, `galleryImages`), so the orchestrator needs to know which field was targeted. Stores, blog, and forms have fixed or no image targets, so they omit this line.

Extra fields (e.g., `Pages wired:`, `Components:`) are allowed and encouraged — more context helps the orchestrator and future skills understand what was built. The fields above are the required minimum.

## Status Values

| Status | Meaning |
|--------|---------|
| `complete` | All steps in the skill's build order finished successfully |
| `partial` | Some steps completed but others failed (e.g., 2 of 3 products created) |
| `failed` | The skill could not complete its work |

## Image Values

| Value | Meaning | Orchestrator Action |
|-------|---------|-------------------|
| `generated (n/n attached)` | Images were created and attached to items | None — all good |
| `skipped ({reason})` | Skill intentionally skipped images (e.g., user declined, not needed for this site) | None — acceptable |
| `not applicable` | Skill has no image fields (e.g., forms) | None — not applicable to this skill |
| `not attempted` | Image generation step was never executed | **Failure state** — orchestrator must catch this and run image generation |

**Only `not attempted` is a failure state.** Both `generated` and `skipped` are acceptable outcomes — `skipped` means a deliberate decision was made, not that a step was missed.

## Rules

1. Every content-producing skill MUST write a log entry before returning to the orchestrator
2. Create the file with `# Features Log` as the first line if it doesn't exist
3. `not attempted` is the only image failure state — the orchestrator will re-run image generation for these
4. `skipped` requires a parenthetical reason (e.g., `skipped (user declined)`, `skipped (not needed for this site)`)
5. `not applicable` replaces the old `n/a` — use the full phrase for clarity
6. `Image field:` is only for CMS skills where the field name varies per collection
7. Extra fields beyond the required four are allowed — add them when they help explain what was built
8. Always append — never overwrite other skills' entries
9. The orchestrator reads this log during its Shared Ending verification phase

## Complete Multi-Skill Example

A project with stores, forms, blog, and two CMS collections:

```markdown
# Features Log

## stores
- Status: complete
- Content: 12 products in catalog (Wix Stores sample products replaced via MCP)
- Images: generated (4/4 attached)
- Pages wired: products listing, product detail, cart, checkout redirect, thank-you

## forms
- Status: complete
- Content: "Contact Us" form created (fields: first_name, last_name, email, phone, message)
- Images: not applicable

## blog
- Status: complete
- Content: 3 posts created ("Mastering Espresso", "Our Sourcing Story", "Brewing at Home")
- Images: generated (3/3 attached)

## cms/TeamMembers
- Status: complete
- Content: 4 items created (Alex, Jordan, Sam, Taylor)
- Image field: photo
- Images: generated (4/4 attached)

## cms/FAQ
- Status: complete
- Content: 6 items created (shipping, returns, wholesale, subscriptions, brew guides, gift cards)
- Images: not applicable
```
