# Content floor — the copy you write on every authored surface

**A fallback, not an override.** If the user supplied copy, voice, or tone, use theirs. Two rules
hold regardless: the first, a comprehension floor, and the last, where pictures come from.

- **Say what the business is, literally, above the fold.** A first-time visitor must know
  what the site *is* and can *do* from the hero alone. The business category ("ceramics
  studio", "trattoria", "yoga studio") appears verbatim in the H1, the kicker above it, or
  the first clause of the subtitle. A witty H1 is welcome — beside an explicit category,
  never instead of one.
- **The subtitle leads with the offer** — the verb the visitor cares about comes early
  ("Book…", "Order…", "Browse…"), flavor after.
- **Kickers carry information or don't exist.** "Handmade in Portland · Since 2019" earns its
  place; "The Collection" above a Collection heading doesn't. A voice-led H1 pairs with an
  informative kicker (that's where the category goes).
- **Titles and subtitles end without a period.** Paragraphs keep theirs.
- **CTA labels are short, concrete, and not all-caps** — the actual action, matching the one
  primary CTA per page (`DESIGN.md`).
- **No fluff.** Every line moves a visitor's understanding forward — the H1 and subtitle most
  of all.
- **A caption describes what its image actually shows.** A slogan overlaid on a photo is not
  a caption; if none is warranted, write none.
- **Every picture is in the site's Wix Media**, on an item or on a page (a hero, a banner): the
  user's own file, an image generated for the site, or one imported from a source the user
  supplied or whose license allows it, through `seed/images.mjs` (`generateImage`,
  `importImage`) or `UploadImageToWixSite`. Never a link to a picture on another website, in a
  page or in the site's data: that site did not license it to this one, and the picture breaks
  when its host moves or blocks it. A picture you cannot get this way is left out, and the
  surface is designed without it.
