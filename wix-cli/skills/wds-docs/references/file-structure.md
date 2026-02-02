# WDS Docs File Structure

## Example File Format

```markdown
## Feature Examples

### ExampleName                    ← Line N (grep "^### " to find)
- description: What it shows
- example:
````jsx
<Component prop="value">          ← Start reading from line N
  Content
</Component>
````

### NextExample                    ← ~20-50 lines later
...
```

**Strategy:** Grep `^### ` → get line numbers → read from offset with limit=40-50

## Props File Format

```markdown
### propName                       ← Every 3 lines
- type: TypeDefinition
- description: What it does
```

**Strategy:** Small files (<100 lines) read fully. Large files (Box) grep specific prop.

## File Sizes

| File | Lines | Strategy |
|------|-------|----------|
| components.md | ~970 | Grep, never read fully |
| icons.md | ~400 | Grep for specific icon |
| Most Props.md | 30-100 | Read fully OK |
| BoxProps.md | 8000+ | Grep only! |
| Most Examples.md | 100-600 | Grep → offset read |
| PageExamples.md | 940 | Grep → offset read |

## Common Components

### High-traffic (learn these patterns)
- Button, Input, FormField, Dropdown
- Table, Card, Page, Modal
- Box, Layout, Cell

### Grep patterns by use case

```bash
# Forms
Grep: "form\|input\|validation" in components.md

# Layout
Grep: "layout\|page\|card\|box" in components.md

# Data display
Grep: "table\|list\|badge" in components.md

# Feedback
Grep: "notification\|toast\|loader" in components.md
```
