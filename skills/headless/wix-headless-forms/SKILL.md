---
name: wix-headless-forms
description: "Inner skill — invoked by wix-headless-features-orchestrator. Implements contact, lead, and signup forms using @wix/forms."
---

# Wix Headless Forms — Form Implementation

Wires designed form components to `@wix/forms` — server-side schema fetching for field discovery and client-side submission as a React island.

## Anti-Patterns

| WRONG | CORRECT |
|-------|---------|
| Hardcode form field IDs or form ID | Use `forms.listForms("wix.form_app.form")` with `auth.elevate` to discover forms at runtime |
| Replace ContactForm.astro with .tsx without migrating styles | Copy `<style is:global>` from the .astro placeholder into the page before replacing the import |
| Skip `auth.elevate` when listing forms | `listForms` requires elevated permissions — always elevate |
| Submit forms from server-side code | Form submission must happen client-side (React island with `client:only="react"`) |
| Create form fields manually in code | Fetch the form schema from the API and render fields dynamically |

> **Visual boundary:** This skill handles SDK integration only. All styling is owned by the design skill. React islands must use the class names from the designed component's styling contract. Do not add Tailwind classes, inline styles, or `<style>` blocks.

## Required Dependencies

```
@wix/forms
```

> Features collects these for a single batch install — do NOT install independently.

## Step 0: Determine Form Requirements

Before writing any code, determine what fields the form needs:

1. **Read the functional plan** — identify the form's purpose (contact, waitlist, lead capture, signup, etc.)
2. **Read the designed component** — check what fields the placeholder shows and note its class names
3. **If ambiguous**, ask the user via `AskUserQuestion`: *"What should this form collect?"*
   - Just email (waitlist / newsletter)
   - Name + email (lead capture)
   - Full contact (name, email, phone, message)
   - Custom — let me specify

**Purpose → field mapping:**

| Purpose | Fields |
|---------|--------|
| Waitlist / newsletter | `email` only |
| Lead capture | `first_name`, `email` |
| Contact | `first_name`, `last_name`, `email`, `phone`, `message` |
| Registration | `first_name`, `last_name`, `email` + any custom fields |

## Step 1: Use the Styling Contract

The React island must use the same class names as the designed placeholder (the styling contract from the design skill's `COMPONENT_PATTERNS.md` → Contact Form). The designed component's `<style is:global>` block already handles all visual styling including dark-site-safe input backgrounds. Do not duplicate styles in the component.

## Implementation

Use the field list from Step 0 when creating forms via MCP (only include the fields needed for the form's purpose). Follow the design rules from Step 1 when generating the React component.

| Reference | What It Covers |
|-----------|---------------|
| `references/CONTACT_FORM.md` | MCP-assisted form setup, field selection patterns, server-side schema fetching, client-side submission, design-aware components |

After form implementation is complete, **log results** to `.wix/features.log.md` per `../shared/FEATURES_LOG.md`, and **append a lifecycle entry** (`####` sub-phase) to `.wix/lifecycle.log.md` per `../shared/LIFECYCLE_LOG.md`.

If MCP is available, ensure a form exists on the site before wiring code (see Form Setup section in reference). If no forms exist and MCP is unavailable, tell the user to create a form in the Wix dashboard.
