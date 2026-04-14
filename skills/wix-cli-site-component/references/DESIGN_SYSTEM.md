# Design System Guidelines

Creative design principles for building distinctive, award-winning site components that avoid generic "AI slop" aesthetics.

## 1. Spacing as Communication

Spacing communicates relationships and hierarchy—not decoration.

### Semantic Roles

| Role | Purpose | Implementation |
|------|---------|----------------|
| **Padding** | Internal breathing room | Prevents cramped layouts |
| **Gap** | Relationship indicator | Consistent gaps = visual unity |
| **Margin** | Section separation | Clear boundaries between major blocks |
| **Whitespace** | Focus amplifier | Strategic emptiness = premium feel |

### Spacing Scale

| Relationship | Value | Use Case | Example |
|---|---|---|---|
| Tight (icon + label) | 0.25-0.5rem (4-8px) | Clustering related items | Button icon + text |
| Same category | 1-1.5rem (16-24px) | Card sections, form fields | Title + description |
| Different sections | 2-3rem (32-48px) | Major content blocks | Hero + features |
| Emphasis/Drama | 4rem+ (64px+) | Hero content, luxury feel | Landing page sections |

**Generous Whitespace**: 1.5rem/24px, 2rem/32px, 2.5rem/40px create sophistication and clarity. Design clean, spacious layouts that breathe.

## 2. Alignment as Intent

Every alignment choice must support comprehension and flow—never default.

### Principles

- **Proximity**: Group related elements
- **Consistency**: Same pattern for same type
- **Balance**: Distribute visual weight
- **Scanability**: Guide the eye naturally

### Alignment Patterns

| Element Type | Horizontal | Vertical | Reasoning |
|---|---|---|---|
| Body text, lists | Left | Top | Natural reading flow |
| Headlines, CTAs | Center | Center | Draw attention |
| Metadata, timestamps | Right | — | Secondary information |
| Form inputs | Stretch | — | Maximize usability |

## 3. Layout Patterns

Choose patterns that serve the component's purpose—don't default to the first idea.

| Pattern | When to Use | Spacing Strategy | Best For |
|---|---|---|---|
| **Single-Column** | Simple, focused (hero, single CTA) | Generous vertical gaps (2-3rem) | Focused actions, mobile-first |
| **Two-Column Split** | Contrasting content (image + text) | Balance weight with whitespace | Profile cards, features |
| **Grid/Multi-Column** | Repeating items (galleries, cards) | Consistent gaps, subtle depth | Collections, dashboards |
| **Stacked + Emphasis** | Primary + metadata (pricing) | Large top element, smaller secondary | Pricing, announcements |

## 4. Visual Consistency

All similar elements must share the same visual DNA.

### Corner Radius Strategy

| Style | Range | Use Case | Personality |
|-------|-------|----------|-------------|
| Sharp | 0-4px | Editorial, Luxury, Technical | Precise, modern |
| Rounded | 6-12px | Contemporary, Professional | Friendly, approachable |
| Soft | 16px+ | Playful, Consumer | Warm, casual |

**Rule:** All buttons same radius, all cards same radius, all inputs same radius.

### Shadow Levels (Max 3)

| Level | Value | Use Case |
|-------|-------|----------|
| Rest | `0 1px 2px rgba(0,0,0,0.05)` | Default card state |
| Hover | `0 4px 12px rgba(0,0,0,0.08)` | Interactive hover |
| Floating | `0 8px 24px rgba(0,0,0,0.12)` | Modals, dropdowns |

**Borders**: Consistent weight (all 1px or all 2px). Don't mix styles.
**Element Heights**: All primary buttons same height, all inputs same height.

## 5. Color Strategy

Color creates hierarchy, zones, and rhythm—not just decoration.

### Token Usage

- **Backgrounds**: Use accent tints for section backgrounds, base-1 for primary
- **Depth**: Mid-tone shades for layering, subtle background shifts for distinction
- **Emphasis**: Vibrant accents for CTAs, highlights, focus states
- **Text**: High contrast for readability. Primary on base, secondary with reduced opacity or shade

### Principles

- Embrace the full palette—don't limit to monochromatic unless context demands it
- Create visual interest through color variety
- Use color purposefully for hierarchy and zones, not decoration
- Ensure sufficient contrast (WCAG AA minimum)

## 6. Typography as Structure

Typography creates hierarchy without relying on color.

### Font Selection Principles

1. **Establish Clear Hierarchy**: Use font size and weight for visual hierarchy
2. **Maintain Consistency**: Apply font stack and sizing scale consistently
3. **Anchor & Pair**: Pair fonts that complement each other

### Hierarchy Rules

- **Max 3 levels** per component
- **Size contrast**: Headlines 1.5-2x body size minimum
- **Weight contrast**: 700 for emphasis, 400-500 for body

### Legibility

- Line-height: 1.5-1.7 (body), 1.1-1.3 (headings)
- Line length: 45-75 characters (optimal readability)
- Avoid orphans (no single word on final line)

## 7. Motion System

All animations: pure CSS, smooth, purposeful.

### Timing

| Interaction | Duration | Easing |
|---|---|---|
| Hover, click | 150-200ms | `ease-out` |
| Active states | 250ms | `ease-out` |
| Content reveals | 400-500ms | `ease-out` or `cubic-bezier(0.34, 1.56, 0.64, 1)` (spring) |

### Standard Reveal Animation

```css
@keyframes contentAppear {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
```

### Rules

- Only animate `transform` and `opacity` (GPU-accelerated)
- Respect `prefers-reduced-motion` (only allowed media query)
- No looping (except loading spinners)

## 8. Creative Exploration

Push beyond the obvious. Award-winning design comes from exploring multiple creative directions.

### Trigger Questions

1. **"What are 3 different layout approaches for this?"** → Sketch mentally before choosing
2. **"What would make a user say 'wow'?"** → Aim for delight, not just function
3. **"How can proportion create interest?"** → Vary sizes, use asymmetry intentionally
4. **"What interaction details would feel polished?"** → Hover states, micro-animations

### Pattern Ideas

**Cards**: Asymmetric grids (60/40 split) · Overlapping elements with z-index · Thick accent border (3-4px) on one side · Color blocking backgrounds · Typography-first (massive headline as anchor)

**Lists & Collections**: Alternating styles (bordered vs shadow) · Spotlight pattern (every 3rd item larger) · Color rhythm (alternating backgrounds) · Horizontal scroll with varied widths

**Interactive Elements**: Split buttons (action + dropdown) · Icons in colored circles · Progress with color transitions · Large toggles with smooth transitions

**Content Hierarchy**: Large numbers (3-4x size for stats) · Quote callouts (thick left border + tinted background) · Whitespace as divider (4rem+) · Pill badges (tight padding, accent background)

**Spacing Drama**: Use 40-64px padding for hero sections. Tight clustering (4-8px) + huge gaps (40px+) between groups. Asymmetric margins (24px top, 40px bottom).

## 9. Forbidden Patterns (Anti-LLM-Default)

**Never use these unless explicitly requested:**

- Generic shadows: `box-shadow: 0 2px 4px rgba(0,0,0,0.1)` → Use the shadow levels above
- Default browser outlines → Implement custom accessible focus states
- Decorative accent lines above titles → Use whitespace and typography instead
- Emojis or decorative shapes → Avoid unless core to request
- Looping animations → Only for loading states
- Center-aligned multi-line body text → Hard to read
