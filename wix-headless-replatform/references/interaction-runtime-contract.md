# Interaction Runtime Contract

Use this contract after `interaction-map.json` and `scene-contract.json` identify one or
more core scenes.

## Principle

Implement the observed state machine, not the source library. A source may use GSAP,
Framer Motion, Web Animations, CSS transitions, or custom JavaScript. The clone may use a
different mechanism as long as its content, visual states, transition shape, responsive
behavior, and interaction invariants match the evidence.

Do not translate a scene contract to more descriptive prose. Start from the declared
primitive, bind extracted content and media to it, and expose the QA markers below.

## Required markers

Every core scene:

```html
<section data-rp-scene="home-home-section-002" data-rp-initialized="active-card-rail">...</section>
```

Active-card rail:

```html
<section data-rp-scene="..." data-rp-initial-state="all-collapsed">
<div data-rp-viewport>
  <div data-rp-track>
    <article data-rp-item data-rp-hover-target data-rp-active="true">
      <button data-rp-activate>...</button>
    </article>
  </div>
</div>
</section>
```

Content switcher:

```html
<button data-rp-item data-rp-activate data-rp-active="true">...</button>
<div data-rp-panel>...</div>
```

Scroll scene:

```html
<section data-rp-scene="..." data-rp-phase="approach">
  <div data-rp-visual>...</div>
  <div data-rp-content>...</div>
  <div data-rp-curtain="left"></div>
  <div data-rp-curtain="right"></div>
  <div data-rp-panel>...</div>
</section>
```

Markers are implementation instrumentation. Do not copy source selectors into them.

`site-clone.mjs` installs framework-source copies and browser-ready public copies. The
default and safest startup is the exact contract bootstrap, included once by the page:

```html
<script type="module" src="/site-clone/rp-interactions-bootstrap.mjs"></script>
```

Do not use an inline raw-browser import of `../lib/rp-interactions.mjs`; a browser URL is
not resolved from `src/`. The bootstrap auto-binds complete marker contracts after DOM
readiness. `data-rp-initialized` is runtime evidence, not a marker to hard-code in markup.
Source-specific CSS and content still belong in the page/component implementation.

## Primitive rules

### `active-card-rail`

- Render every captured repeated item in source order.
- Keep a real horizontal track inside a separate scroll viewport; do not substitute a grid.
- Put `overflow-x` and scrolling on `data-rp-viewport`; put `width: max-content` or the
  equivalent row sizing on `data-rp-track`. A max-content track cannot be its own viewport.
- Use the exact captured initial active indexes. Set `data-rp-initial-state="all-collapsed"`
  when source has none; runtime initialization must not auto-open an item.
- Reproduce the measured separation mechanism: track gap, geometric gap, item margin,
  divider, inner inset, or flush.
- Preserve the observed expanded/collapsed width ratio within the contract tolerance.
- Controls and direct item activation must update the same state.
- Mark the source hover surface with `data-rp-hover-target` and reproduce its visual hover
  treatment with keyboard-equivalent focus styling.
- Reproduce nested reveal order and approximate settle time from the captured timeline.

### `content-switcher`

- Use visible controls with one current state.
- Keep all captured state content in the implementation.
- Change the visible `data-rp-panel` content and active marker on activation.
- Preserve keyboard access and relevant ARIA state.
- Give controls and panels matching `data-rp-state` values so `bindContentSwitcher` can
  manage state deterministically.

### `scroll-scene`

- Derive progress from the scene's own scroll range.
- Preserve entry/approach phases and internal pinned phases in their captured order.
- Keep `data-rp-phase` synchronized with the visual state.
- Expose continuous `--rp-entry-progress` and `--rp-scroll-progress` custom properties.
- Mark only the measured pinned/cropped/scaled visual wrapper with `data-rp-visual`.
- Mark independently positioned copy with `data-rp-content` and keep it outside visual
  scaling unless source content geometry explicitly scales.
- Reproduce large sibling reveal layers from `sceneLayers`, including paired curtains or
  masks. Mark observed curtains with `data-rp-curtain` so reveal distance is verified even
  when the media itself stays full-width.
- Do not flatten the scene into static columns when source evidence includes pinning.
- Pass captured phase names/progress thresholds to `bindScrollScene`; combine it with
  `bindContentSwitcher` when tabs share the same scene.

### `sticky-header` and `media-scene`

- Preserve the captured trigger threshold and material chrome changes.
- Keep source-backed media interactive with the recorded URL and playback flags.
- Treat a poster or background with `fallbackPolicy: "fallback-only"` as mutually exclusive
  with a successfully loaded video/iframe. Do not leave it as a visible layer behind media.

## Runtime QA

Start the clone locally, then run:

```bash
node scripts/verify-interactions.mjs \
  --out projects/<project-name> \
  --clone-url http://127.0.0.1:4321 \
  --project-root <project-root>
```

The command writes `docs/site-clone/interaction-qa.json` and exits non-zero if a core
scene is absent, lacks its runtime initialization token, or violates its assertions. Fix
failures before final visual polish.
