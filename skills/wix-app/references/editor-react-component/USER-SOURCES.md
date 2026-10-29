# User Sources

Reuse attached or pasted code, designs, images and other resources to achieve
the new component's requested look, feel and functionality. The user's prompt
defines the outcome. Inspect the relevant sources and choose the assets,
visual patterns, interactions and logic that help build it with Wix platform
capabilities.

## Build an Editable Wix Component

Build the new component around Wix's component contract and editor features,
adapting useful code and assets from the supplied sources. Connect its content,
appearance and behavior to settings, Manage Items, named parts, design controls
and platform states as appropriate. Choose the implementation, DOM structure
and file organization that support both the requested experience and these
editing capabilities.

- Keep the scaffold's file roles and defaults wiring. Follow
  `COMPONENT-CONTRACT.md` for public props, media values and collections.
- Expose the content and behavior the owner needs to edit. Use typed media
  and links, meaningful defaults, and arrays of item objects for Manage Items.
- Connect independently editable elements as named parts with `PARTS.md`.
  Use `PROPS-VS-CSS.md` and `CSS-GUIDELINES.md` to make appearance editable
  through the design panel and responsive to the component's container.
- Use platform-supported states and interactions where they fit the request.
  `DESIGN-STATES.md` covers editable states; `ANIMATED-COMPONENTS.md` covers
  playback controls and editor preview behavior. For canvas rendering, use
  `CANVAS-COMPONENTS.md` to keep settings and drawing updates connected.
- Choose compatible dependencies for the Wix app, reusing the source's
  libraries when they help achieve the requested behavior. Follow the shared
  dependency and runtime guidance in `SKILL.md` and `REACT-GUIDELINES.md`.

### Optional Engine Reuse

An existing shader, renderer, simulation or image painter can be reused in a
helper module when it helps deliver the requested experience. Reuse the
algorithms that matter to the request and connect them to the component's
editable values and lifecycle. An engine file is optional; React logic can
remain in components or hooks that fit the implementation.

## Designs and Images

Use a supplied design to guide the requested layout, typography, content and
visual states, adapting it to Wix's editable parts and responsive layout.
Additional screenshots can clarify states or different sizes. Use supplied
photos and other assets where they contribute to the requested result.

## Image Helpers

`upload-media.cjs` uploads local images or image URLs to Wix Media. It returns
an `image` value containing `uri` and a Wix-hosted `url`: use the URL for
rendering and the image value, with `alt`, for component defaults following
`COMPONENT-CONTRACT.md`.

Scripts are in the `scripts/` directory beside the active `SKILL.md`. The
examples below use `<SKILL_ROOT>` as a placeholder for the directory containing
that file; replace it with the actual skill path and supply the relevant input
paths. Run the scripts from the app root so they use the site's Wix CLI session.

```bash
node <SKILL_ROOT>/scripts/upload-media.cjs <image-file-or-url>
```

For photographs needed from a larger screenshot, the helper can report image
dimensions and crop the relevant regions before uploading. `--crop` applies
to the next input; coordinates may be pixels or percentages. Inspect the
resulting crops to check that they contain the intended content.

```bash
node <SKILL_ROOT>/scripts/upload-media.cjs --size <screenshot>
node <SKILL_ROOT>/scripts/upload-media.cjs --crop 0,12%,25%,74% <screenshot>
```

If source code paints an image that should be an editable asset, the optional
`render-images.cjs` helper runs an exported painter in Node with Canvas 2D
support. The painter returns a canvas or `data:image/...` URL; the helper
writes it to a file. Pass its `renders[].file` output to the upload helper.
The export's arguments are JSON arrays; choose them for the images the
component needs.

```bash
node <SKILL_ROOT>/scripts/render-images.cjs <painter-file> <export-name> '[3, "dawn"]'
node <SKILL_ROOT>/scripts/upload-media.cjs <rendered-file>
```

Review the helpers' per-image results and explain any unavailable asset that
affects the requested result. Owner-replaceable SVGs follow `VECTOR-ART.md`.

## Review the Result

Check the new component against the requested look, feel and functionality,
including how content, settings, Manage Items and design controls update it.
Validate using the normal component workflow and explain material adaptations
or remaining limitations.

For an additional source-aware review, `scan-user-source.cjs` can highlight
possible integration issues. It reads attached source files from
`.wix/agentInput/attachments` by default; `--source <file-or-directory>` selects
another source. Resolve the script path as described above, for example:

```bash
node <SKILL_ROOT>/scripts/scan-user-source.cjs src/extensions/site/components/<component-name>
```

Treat its findings as clues to inspect against the prompt and Wix component
contract. Address applicable issues and rerun after relevant changes. A clean
report covers the script's checks; functionality and editor behavior need
their own verification. Summarize meaningful remaining limitations in plain
language.
