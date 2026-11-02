# User Sources

Use this reference when the user supplies code, a design or images.

**Read first, in full, before any code:** `DESIGN-STATES.md` when the source
has states (hover, selected, open, a mode it switches into);
`ANIMATED-COMPONENTS.md` when it moves; `CANVAS-COMPONENTS.md` when it redraws
a `<canvas>` every frame (WebGL, three.js, p5, Canvas 2D).

| The user sent | It is | Section |
| --- | --- | --- |
| Code, attached or pasted (with its CSS or data files) | The implementation | Building from the user's code |
| A screenshot or design of the component to build | The design | Building from a screenshot or design |
| A photo or image to show inside the component | Content | Images to put inside the component |

If the request doesn't say: "build this" with a screenshot is a design; photos
sent with code or a written request are content. The request wins over the
files. Say which you chose in your final message.

**For every kind of source, first:** before you write `props.ts`, upload every
image the source has (image files and URLs in the code, images it paints,
rendered in step 1, photos in a screenshot, attached images) with `upload-media.cjs` and use the
results as the defaults (How to upload images). The contract's pool is only for
a slot the source has no image for, or whose upload failed. In your final
message, list each image's upload result.

## Building from the user's code

The user's code is the specification: port it as closely as you can; never
redesign or simplify it. Keep its DOM and inline markup (an `<i>` in a title),
its layout and CSS values at every width and in dark mode, every animation with
its timing (entrances included), interactions, state logic, copy word for word,
and link targets. Change only what this skill requires, each change as small as
possible. Save pasted code first, as pasted, in
`.wix/agentInput/attachments/pasted/` (`Hero.tsx`, CSS beside it) and run every
step on them. Before you write any other file, note what each step 7 check maps
to in this source (`DEFAULT_ITEMS` → `items` array prop, `accent` →
`--accent`). Then, in order:

1. **Copy the logic, never the component.** The logic is the code with no
   hooks or JSX: an engine class, a WebGL scene, a chart renderer, a game loop,
   an image painter. `cp` the source file to `<component-name>-engine.ts`
   (`.js` plus a `.d.ts` typing what the component calls, for a JavaScript
   source) and delete every component, hook and JSX line from the copy; never
   rewrite or simplify what remains. Never copy the component into a `.tsx` or
   `.jsx` file, or import or render it: the scaffold component replaces it.
   With no such logic, copy nothing.
   If the source paints images, export the painter and, before writing any
   other file, render each default item's image and upload the renders:

   ```bash
   node <SKILL_ROOT>/scripts/render-images.cjs <engine-file> <export> '<json args>' …
   node <SKILL_ROOT>/scripts/upload-media.cjs <each renders[].file>
   ```
2. **Lift what the owner edits out of the logic.**
   - Elements the logic builds (`createElement`, `innerHTML`, `appendChild`:
     hotspots, labels, slides) are rendered in JSX as named parts per
     `PARTS.md`, named after the source's; the logic finds each by a `data-*`
     attribute only to place, show or update it.
   - Every list of items (a `DEFAULT_*` constant, a fallback array, a list
     inside the logic) becomes an `Array<{…}>` prop whose defaults are the
     source's items, so the editor offers Manage Items; the logic reads it from
     props.
   - Colors and fonts the logic uses (materials, canvas fills, `ctx.font`), and
     ones the source takes as props (`accent`), become CSS custom properties
     declared on the root in module CSS with the source's values, which the
     logic reads; on a canvas, register and read them per
     `CANVAS-COMPONENTS.md`. Load the source's web fonts from `@fontsource/*`.
3. **Move the React part into the scaffold files.** Its hooks, effects,
   handlers, measuring code (`ResizeObserver`, `offsetWidth`), helpers and
   sub-components move in as they are, with only prop and ref names changed:
   each prop branch (`side`), delay, spring, render condition and computed
   value; never a fallback. A `window` pointer listener moves to the root
   (reset on leave). Add nothing the source doesn't have (an attribute, an
   initial value, a guard). An element you add (the play button) calls
   `stopPropagation()` in its own `onPointerDown`, `onPointerUp` and `onClick`.
   - Text the owner sees on the page (source props or written in its JSX),
     images and links become props whose defaults are the source's values
     (`'#'` too); screen-reader text and a form `name` stay in code. A
     fixed list of values becomes a union type with the source's default, also
     when the source accepts any number besides its presets (`'22 L' | '28 L' |
     '34 L'`, not 18–40); other numbers stay numbers, with `@min`/`@max` in the
     unit the owner thinks in (0–100, not 0–1).
   - Owners edit names, text and choices, never coordinates, vectors or IDs:
     positions the items carry (a 3D point, a lat/lng) become a dropdown named
     after each item (`'lid' | 'pocket'`), mapped to its values in code.
   - Keep every prop the source offers; an internal value becomes a choice and
     a color or font goes to CSS. An object prop becomes one prop per field,
     with the source's default and comment; rendered `children` stay a
     `ReactNode` slot.
   - Each part's styling goes in its module CSS rule with the source's values:
     the source's classes become module classes (`card` → `styles.card`),
     never `:global()` rules, and Tailwind utilities become their CSS values. The root's `display` moves to `--display`
     (`--display: flex`), never `display`. Never import the source's
     stylesheet or keep a `<style>` tag; a part's font and colors are literals
     (`CSS-GUIDELINES.md`, `PROPS-VS-CSS.md`).
4. **Map the source's states** per `DESIGN-STATES.md`: interactive parts get
   hover; a selected item (a picked tab or slide) becomes an `ActiveItemIndex`
   prop with an `active` state; a view the whole component switches into
   (open, exploded, a diagram view) becomes a root `ElementState` prop, even
   when the source keeps it as a boolean or one value of a mode string.
5. **Fit the editor.**
   - Motion gets a play/pause icon button per `ANIMATED-COMPONENTS.md`; while
     designing (`useIsEditMode`), motion pauses and the active item shows. A
     canvas loop follows `CANVAS-COMPONENTS.md`.
   - Add no visible element, background, border or shadow the source doesn't
     have.
   - Keep the source's layout, adapting only what it needs to fit its container
     (`CSS-GUIDELINES.md`, `OVERFLOW.md`): each breakpoint, a viewport `@media`
     or a Tailwind `sm:`–`2xl:` variant (640, 768, 1024, 1280, 1536px), becomes
     a `@container` query at the same width with the same values, and `dark:`
     variants a `@media (prefers-color-scheme: dark)` rule.
   - Keep the libraries the source imports at its versions; if the app has
     another, install the source's under an npm alias
     (`three-128@npm:three@0.128.0`). Never change the code to fit a version.
6. **Images:** every image the code uses, URLs included, is uploaded; never
   keep the original URL or swap in a stock image. Keep the painter for items
   added later.
7. **Check before you validate.** Run it exactly as written, without quotes:

   ```bash
   node <SKILL_ROOT>/scripts/scan-user-source.cjs src/extensions/site/components/<component-name>
   ```

   Fix everything it lists, however large (built elements into JSX parts,
   rules onto module classes, colors into CSS variables), then rerun it once.
   In your final message, say what you built in plain words, then add each
   `tellTheOwner` sentence the rerun still lists, as written.

When the source and a reference disagree, the reference decides how it works
(a clickable `div` becomes a `<button>` styled the same) and the source how it
looks, over the `VISUAL-QUALITY.md` defaults.

## Building from a screenshot or design

Match the design, not the `VISUAL-QUALITY.md` defaults: layout, proportions and
spacing; the closest `@fontsource/*` font of its kind (geometric or humanist
sans, serif, mono; never Arial) with a generic fallback,
its weights, sizes, letter spacing and case; colors, borders, radii, shadows
and controls. Its text becomes text props. Its photos are images the user wants in the component, even
when the request calls the screenshot a reference: crop and upload each one.
Extra screenshots show its states or narrow layouts.

## Images to put inside the component

Upload each image as it is and make it that slot's default. Don't restyle the
component around it.

## How to upload images

An `Image` default must be a Wix Media file with a `uri`
(`COMPONENT-CONTRACT.md`); without it the editor rejects every save, so panel
edits never reach the component. From the app root:

```bash
node <SKILL_ROOT>/scripts/upload-media.cjs --size <screenshot>
node <SKILL_ROOT>/scripts/upload-media.cjs --crop 0,12%,25%,74% <screenshot> <photo.jpg> <https://image-url>
```

`--crop left,top,width,height` (pixels or %) applies to the next image; repeat
it per photo. For a screenshot, run `--size` first, then crop each photo at its
own edges, never in fixed tiles; look at each crop in `/tmp/user-images` and
redo any that cuts into a neighbor. Each `uploads[].image` (`{ uri, url }`) is that slot's default; add
`alt`. An SVG icon the owner should replace follows `VECTOR-ART.md` instead.

Never use a stock or drawn substitute, a CSS gradient for a painted image, a
`?url` file, the attachment's link, or the whole screenshot as an `Image`. Only when the script fails for an
image (`uploads[].error` says why), use the contract's pool for that slot and
say so in your final message.
