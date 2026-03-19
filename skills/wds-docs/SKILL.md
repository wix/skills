---
name: wds-docs
description: Wix Design System component reference. Use when building UI with @wix/design-system, choosing components, or checking props and examples. Triggers on "what component", "how do I make", "WDS", "show me props", component names like Button, Card, Modal, Box, Text, or when importing from @wix/design-system or @wix/wix-ui-icons-common. Also use when looking up spacing tokens (SP1-SP6) or icon names.
compatibility: Requires @wix/design-system package installed in the project.
---

# WDS Documentation Navigator

## FAST PATH: Cheat Sheets First (1 Read covers 90% of cases)

Before using the staged docs lookup, check the **pre-built references** in this skill's `references/` folder.

### Step 1: Read the cheat sheet

Read **one file** that covers your needs:

| Need | File | Covers |
|------|------|--------|
| Component props & snippets | `references/COMMON_COMPONENTS.md` | Top ~20 components with correct types, snippets, deprecation warnings, and gotchas |
| Dashboard page patterns | `references/RECIPES.md` | CRUD table, form modal, delete confirm, settings card, selection, empty state |
| Icon names | `references/ICONS.md` | ~100 most-used icons organized by category, naming conventions |

**For most tasks, reading `COMMON_COMPONENTS.md` + `ICONS.md` is sufficient (2 Reads total).**

### Step 2: Only fall back to full docs if needed

If a component is NOT in the cheat sheet, use the staged lookup below.

---

## SLOW PATH: Full Docs Lookup (for uncommon components)

**Docs path:** `node_modules/@wix/design-system/dist/docs/`

### CRITICAL: Never Read Entire Files

Files are 200-900+ lines. Follow the staged discovery flow below.

### Stage 1: Find Component

```bash
Grep: "table" in components.md
Grep: "form\|input\|validation" in components.md
```

**Output:** Component name + description + do/don'ts → Go to Stage 2

### Stage 2: Get Props + Example List

```bash
# 2a. Get props (small files OK to read, large files grep)
Read: components/ButtonProps.md              # OK if <100 lines
Grep: "### disabled" in components/BoxProps.md -A 3  # Box is huge

# 2b. List available examples (ALWAYS grep, never read)
Grep: "^### " in components/ButtonExamples.md -n
```

### Stage 3: Fetch Specific Example

```bash
Read: components/ButtonExamples.md offset=183 limit=40
```

### Stage 4: Icons (when needed)

Prefer `references/ICONS.md` first. Fall back to:
```bash
Grep: "Add\|Edit\|Delete\|Search" in icons.md
```

---

## Flow Summary

```
┌────────────────────────────────────────────────────────────┐
│ FAST: Read references/COMMON_COMPONENTS.md (1 tool call)   │
│       + references/ICONS.md if icons needed                │
│       + references/RECIPES.md for page patterns            │
│                                                            │
│       → Covers ~90% of components. STOP HERE if covered.   │
└─────────────────────────┬──────────────────────────────────┘
                          ↓ component NOT in cheat sheet
┌────────────────────────────────────────────────────────────┐
│ SLOW Stage 1: Grep components.md for keyword               │
│ SLOW Stage 2: Read {Name}Props.md + Grep Examples headings │
│ SLOW Stage 3: Read specific example with offset            │
└────────────────────────────────────────────────────────────┘
```

---

## Quick Component Mapping (Design → WDS)

| Design Element | WDS Component | Notes |
|----------------|---------------|-------|
| Rectangle/container | `<Box>` | Layout wrapper |
| Text button | `<TextButton>` | Secondary actions |
| Input with label | `<FormField>` + `<Input>` | Wrap inputs |
| Number input | `<NumberInput>` | Prefer over `<Input type="number">` |
| Textarea | `<InputArea>` | Multiline text |
| Toggle | `<ToggleSwitch>` | On/off settings |
| Modal | `<Modal>` + `<CustomModalLayout>` | Use together |
| Confirm dialog | `<Modal>` + `<MessageModalLayout>` | Short messages |
| Grid | `<Layout>` + `<Cell>` | Responsive grid |
| Select/dropdown | `<Dropdown>` | Single select |
| Search | `<Search>` | With optional dropdown |

---

## Spacing (px → SP conversion)

| Token | Classic | Studio |
|-------|---------|--------|
| `SP1` | 6px | 4px |
| `SP2` | 12px | 8px |
| `SP3` | 18px | 12px |
| `SP4` | 24px | 16px |
| `SP5` | 30px | 20px |
| `SP6` | 36px | 24px |

Only use SP tokens for `gap`, `padding`, `margin` — not for width/height.

---

## Imports

```tsx
import { Button, Card, Image } from '@wix/design-system';
import { Add, Edit, Delete } from '@wix/wix-ui-icons-common';
```

---

## File Sizes (for full docs lookup)

| File | Lines | Strategy |
|------|-------|----------|
| components.md | ~970 | Grep, never read fully |
| icons.md | ~400 | Grep, or use references/ICONS.md |
| Most Props.md | 30-100 | Read fully OK |
| BoxProps.md | 8000+ | Grep only! |
| Most Examples.md | 100-600 | Grep → offset read |
| PageExamples.md | 940 | Grep → offset read |
