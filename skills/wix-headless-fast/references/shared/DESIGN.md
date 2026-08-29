# Design floor — every vertical, every surface you author

**A fallback, not an override.** These rules fill the gap when the user gave no design
direction. The moment the brief specifies a palette, a mood, a reference — their intent wins.
They govern the surfaces **you** author on a create run; on a connect/iterate run the design
arrives with the project and the job is wiring, not restyling.
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
- **No emojis** in UI copy, headings, or empty states (unless the brief itself asks for
  them).
- **Skip the stock-photo clichés** — handshakes, lightbulbs, laptops-on-desks read as filler,
  in a generated image as much as a stock one.
- **An image slot with no image gets a styled block** on the theme tokens (palette, radius,
  spacing), never an empty gap or a broken `<img>`. Page imagery comes from the seeded
  entities and these tokens — the seed generates entity images, and no page-image path ships.
- **Vary the look across projects.** Repeating the same palette/layout on unrelated brands is
  a failure mode, not a shortcut — two sites with the same vertical and different briefs
  should look nothing alike.

This constrains the *how*, not the *what* — the brief and the vertical decide what the pages
are; INSTRUCTIONS decides which surfaces exist.
