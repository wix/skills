---
name: forms
triggers: ["contact form", "lead form", "signup form", "waitlist", "registration", "get in touch", "inquiry", "feedback"]
description: "Forms — contact, lead capture, or newsletter signup with CRM integration"

features:
  - name: "Contact form"
    description: "Dynamic form powered by @wix/forms with server-side schema discovery and client-side submission. Submissions create CRM contacts automatically."

apps:
  - name: "Wix Forms"
    appDefId: "225dd912-7dea-4738-8688-4b8c6955ffc2"

packages:
  - "@wix/forms"
  - "@wix/essentials"

routes:
  - route: "/contact"

cmsCollections: []

seed:
  agentLocation: "references/forms/"
  scope: "seed"
  description: "Install Forms app, create form with fields matching business purpose, PATCH postSubmissionTriggers for CRM contact creation"
  references: ["references/forms/CONTACT_FORM.md"]

components:
  agentLocation: "references/forms/"
  scope: "components"
  description: "ContactForm.tsx React island for client-side form submission with dynamic field rendering and validation"
  references: ["references/forms/CONTACT_FORM.md"]
  files:
    - "src/components/ContactForm.tsx"

pages:
  - name: "contact-page"
    agentLocation: "references/forms/"
    scope: "pages"
    description: "Wire designed contact.astro page to @wix/forms SDK — add form discovery query, replace placeholder with ContactForm island, migrate styles"
    references: ["references/forms/CONTACT_FORM.md"]
    files:
      - "src/pages/contact.astro"

creates:
  - { file: src/components/ContactForm.tsx, phase: components }
  - { file: src/pages/contact.astro,        phase: pages }

contributes:
  - file: src/pages/index.astro
    marker: "<!-- home:forms -->"
    description: "Contact CTA (heading + one-liner + button linking to /contact)"
  - file: src/components/Navigation.astro
    marker: "<!-- nav:links -->"
    description: "Contact menu link → /contact"

include: false
disabled: false
---

# Forms Pack

Contact, lead capture, and signup forms with CRM integration. Loaded when the user's prompt mentions forms, contact pages, inquiries, or signups.

## Phase decomposition

| Scope | Phase | Files | Depends on |
|-------|-------|-------|------------|
| `seed` | Phase 1 — Step 3 (bg) | None (MCP only) | MCP connection |
| `components` | Phase 3 — Step 4.5 (bg) | ContactForm.tsx | Styling contract |
| `contact-page` | Phase 4 — Step 7 (bg) | contact.astro | Phase 2 Design System + Phase 1 Seed formId |

All three scopes reference the same `CONTACT_FORM.md` file — it covers MCP form setup, React island implementation, and page wiring in one document. The agent's scope parameter guides it to the correct section.

## Known failure modes (propagate to agent prompts)

| Wrong | Right |
|-------|-------|
| Skip `postSubmissionTriggers` PATCH after form creation | Always PATCH — the POST silently drops triggers; without them, submissions are silently lost (no CRM Contact created) |
| Include triggers in POST body and assume it worked | POST silently drops `postSubmissionTriggers` — always follow up with PATCH |
| Fall back to hardcoded fields on `UNSUPPORTED_FORM_NAMESPACE` | Wait 10s and retry up to 3 times — namespace propagation delay after Forms app install |
| Skip `auth.elevate` when listing forms | `listForms` requires elevated permissions |
| Submit forms from server-side code | Form submission must happen client-side (React island with `client:load`) |
| Replace `.astro` placeholder without migrating styles | Copy the placeholder's `<style is:global>` block to the page — styles vanish when the Astro import is replaced with React |
| Detect textarea by `componentType === "TEXT_AREA"` | Check `identifier === "TEXT_AREA"` or `target === "message"` — the API rejects `TEXT_AREA` as a componentType value |
| Hardcode form field IDs or form ID | Use `forms.listForms("wix.form_app.form")` with `auth.elevate` for runtime discovery |

## Form purpose variants

The forms agent adapts field selection based on the business purpose from the functional plan:

| Purpose | Fields | Layout |
|---------|--------|--------|
| Waitlist / newsletter | EMAIL + SUBMIT | Single column |
| Lead capture | FIRST_NAME + EMAIL + SUBMIT | Single column |
| Contact (full) | FIRST_NAME + LAST_NAME + EMAIL + PHONE + MESSAGE + SUBMIT | First+last side-by-side, rest stacked |
| Registration | FIRST_NAME + LAST_NAME + EMAIL + custom | Single column |

## Images

Forms has no entity images. The contact page gets decorative images via `image-phase-1-decorative` if the image agent is running.

## References

- `references/forms/CONTACT_FORM.md` — All phases: MCP form setup, field building blocks, React island, page wiring, form schema types
