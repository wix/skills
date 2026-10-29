# Visual Quality

Use this reference for a component's default look: hierarchy, spacing, and
foreground/background contrast.

**Visual intent.** When the request specifies how the component should look —
mood, palette, layout style, or a reference — follow that direction; for code,
a design, or images the user supplies, follow `USER-SOURCES.md`. Default to a modern, refined look — intentional layout, pleasing proportions, polished and deliberate styling.

## Default Visual Quality

Create a clear hierarchy with at least two techniques that fit the component:
a defined surface, border or soft shadow, type scale or weight, spacing, an
accent, or visible interaction states. Use these neutral defaults unless the
request or existing design provides better values:

- 16px or larger body text, 14px or larger labels, and 600–700 weight for titles
- 8–16px spacing inside controls and 16–32px spacing inside containers
- 8–12px corner radii for cards and controls; `50%` for circular media
- a subtle border or soft shadow when a card, panel, or control needs separation
- touch targets at least 44 by 44px and visible keyboard focus states

### Foreground and Background Ownership

If the component is a self-contained block (card, panel, banner, accordion item), give the root a background. An inline control meant to blend in (link, ghost button, icon button) may leave it transparent.

- On a transparent root, don't hardcode text or icon colors; inherit them from the parent.
- Set the background and main text/icon color together on the same element. Any secondary text (captions, hints, icons) must still be readable against that same background.
- If an interactive state changes the background, set the foreground color in that state too. Don't assume a color inherited from a parent or from a previous state will still look right on the new background.
- In every default and interactive state, meet WCAG AA contrast: 4.5:1 for body text and 3:1 for large text and UI controls.

A neutral owned surface may use a light background with dark primary and
secondary foregrounds, plus one accessible accent. The exact colors are not a
contract; the contrast relationship is.

## Checklist

- [ ] Visual containers have deliberate hierarchy rather than bare scaffolding.
- [ ] Every explicit foreground has a known contrasting background; transparent
      components inherit foregrounds from their host.
