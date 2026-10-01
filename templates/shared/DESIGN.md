# Design floor — every vertical, every surface you author

**A fallback, not an override.** These rules fill the gap when the user gave no design
direction. The moment the brief specifies a palette, a mood, a reference — their intent wins.
Two exceptions that hold regardless: the contrast floor (in `styles/global.css`, where you
choose the tokens), and the anti-genericism intent — derive the look from *this* brand even
when the user supplied the inputs.

Token judgment (polarity, palette, contrast, type floors) lives in the `@theme` header in
`styles/global.css` — you'll meet it when you set the tokens. This file governs the surfaces:

- **Full-bleed, not boxed.** Don't wrap pages in a narrow centered shell (`max-w-4xl mx-auto`
  around everything). Design for the viewport; use peripheral space intentionally.
- **One primary CTA per page**, worded to the page's actual action — "Add to Cart",
  "Book a Table", "Reserve Your Spot" — never "Submit" / "Click here" / "Learn more" as the
  hero action.
- **Icons render bare on the surface** — no circle/square/pill shell behind nav or card
  glyphs.
- **A card that shows a thing is a link to that thing.** A featured product, dish, service,
  post or event on the home page leads to its own page, or to its place on the listing when the
  vertical has no item pages (`/menu#item-<id>` for a dish). A card with a title, image and price
  and nothing to click is a dead end, not a design choice.
- **Corner shape is a token, never a class.** Shipped buttons, chips, labels and steppers read
  `--radius-control`, which follows `--radius-md` until the brand says otherwise: `9999px` is
  the pill, `0` is square. Cards and fields read `--radius-lg/md/sm`. Don't patch `rounded-*`
  on shipped markup, and give your own controls `rounded-control` so they move with it. Only
  genuine circles (avatars, swatches, dots) stay `rounded-full`.
- **Error text reads `--color-destructive`** (`text-destructive`), never a Tailwind palette
  colour. Set it with the palette so it keeps 4.5:1 on `--color-background`.
- **No emojis** in UI copy, headings, or empty states (unless the brief itself asks for
  them).
- **Vary the look across projects.** Repeating the same palette/layout on unrelated brands is
  a failure mode, not a shortcut — two sites with the same vertical and different briefs
  should look nothing alike.

This constrains the *how*, not the *what* — the brief and the vertical decide what the pages
are; INSTRUCTIONS decides which surfaces exist.
