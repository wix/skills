# Copy an existing site page into Harmony, exactly

Use this when the task is to reproduce a live source page (WordPress, Shopify, anything
public) in a Harmony site. Connecting to the editor and the general editor behaviors are in
[SKILL.md](SKILL.md); read that first.

## Order: create the site, then the data, then the front end

A copy is never started from the editor. The order is fixed:

1. **Create the Harmony site** (blank template, unpublished). Nothing else is done to it yet.
2. **Bring the data first** when the source is a store, bookings, events, blog, or any other
   business that Wix serves from an app (products, categories, services, posts, members and the
   like). Collect the public data, and the private data where the run has access, or both.
   What the data turns out to contain tells you which Wix app to install on the site (for
   example Stores for products and categories), and the data migration (the `wix-replatform`
   flow) then fills that app. A page's product tiles, category links and carousels need real
   catalog items to point at.
3. **Only then copy the front end** in the editor, linking to the migrated items.

Starting the front end before the data is allowed only when the user asks for it and
approves it. State the consequence when asking: product and category links, and any
catalog-driven block (best sellers, category tiles, gift guides), keep pointing at the source
site until the data exists, and they are `openItems` for cutover.

A source with no app data (a brochure site: text, images, contact details) goes straight from
step 1 to step 3.

## The goal is a copy, not a redesign

"Copy the site" means a visitor cannot tell the Harmony page from the source: the same
artwork, fonts, sizes, colours, positions, text and links, **at every screen size the
source supports**. It does **not** mean "inspired by" or "modernized".

For every area, a Wix component that does the same job (collection, signup form, video, cart, social bar...) is used instead of a static picture of it: see item 16.

A freeform rebuild with Harmony's stock components, theme fonts and eyeballed spacing was
tried and rejected ("doesn't look the same at all"). A copy that was exact at 1280 px but
broke at 1836 px and looked bad on mobile was also rejected. Do not stop at one width.

**Done** means all of the following:
- `preview-widths.mjs` shows the Harmony Preview matching the source at 1920, 1836, 1440,
  1280 and 1024 (no element off by more than ~2 px at 1280, proportional elsewhere), and
  its `--scale-check` lists **no** deviations;
- the mobile view (390 px) and tablet widths (768, 1000) show every source text, image
  and link in a readable single column with the source's artwork, no overlaps and nothing
  cut off;
- every link target matches the source (see "Links");
- every remaining difference is listed for the user with its reason;
- the draft is saved. Publishing is the user's decision.

## Method: local copy → description → local check → one deploy → stage steps → verify

The decorative layer is copied as rendered pixels (the plate). Everything a visitor reads or
clicks is a live Harmony component at the measured coordinates. All of it is first written
down in ONE local file, the **page description**, and checked locally; the editor is touched
only by a deterministic deploy. Each problem that used to cost an editor round (overlap
rejection, px values, early wraps, wrong heights) is caught before deploying.

0. **Make a local copy of the whole source site, and prove it.**
   ```
   node scripts/copy/mirror-site.mjs <work>/mirror <url> [<url> ...]   # every page and post URL
   node scripts/copy/serve-mirror.mjs <work>/mirror --port 8732 &
   node scripts/copy/check-mirror.mjs <work>/mirror <work>/mirror-check
   ```
   - Get the URL list from the source's public API (WordPress:
     `?rest_route=/wp/v2/pages&per_page=100&_fields=id,link,title`, same for `posts`).
   - `mirror-site` records every response at 390/1024/1280/1920 (responsive images differ
     per width). Third-party iframes (Google Maps) cannot replay offline, so each is saved as
     a snapshot image and served in its place.
   - `check-mirror` screenshots live and local (local browser cut off from the internet)
     and diffs the pixels. Done when every page is ≤0.1% different with no local 404s and
     no blocked request other than analytics. A run of all zeros is normal for a static
     site; the diff was negative-controlled on two different pages (41%).
   - From here on, measure, plate and compare against `http://127.0.0.1:8732/…` instead of
     the live site: faster, repeatable, and unaffected by source changes.
1. **Find the interactions, then measure the source** (the local copy). First `find-interactions.mjs` (item 17): a hidden tab, accordion or toggle pane is part of the page.
   `node scripts/copy/measure-source.mjs http://127.0.0.1:8732/<page> <work>/source.json --width 1280`
   Besides boxes, fonts and colours it records per text block: `rich` (Harmony-ready HTML,
   inline runs as `<span style>` relative to the block's dominant style, sizes in `em`),
   `segments` (a paragraph that wraps around a float, split into runs that share a line
   width; floats only count in the same block formatting context and after their DOM
   position), `glyphBox` (the words only, without inline icons), `linePitch`, `occluded` and
   `hiddenText` (image-replacement links: a click area over artwork).
2. **Fonts first.** List every family in `texts[].font`. Upload missing ones through the
   editor's **Upload fonts** dialog (SKILL.md → Fonts) and record the `wfont_…` families in a
   font ledger `{ families: { "<Source name>": "<Harmony family>" } }`. Google Fonts files:
   `https://raw.githubusercontent.com/google/fonts/main/<ofl|apache>/<name>/…` (check the
   licence). Generic families map to catalog fonts (`courier` → `courier new`).
3. **Recipes and capabilities (once per site).**
   - `node scripts/copy/export-page.mjs <pageId> <sectionId> <work>/recipes.json` exports an
     already-copied page (styles, content, links, desktop and mobile boxes, pinned items).
     The next page reuses those looks for the same words and images (nav, tabs, notes,
     footer), matched by text AND font size AND colour.
   - `node scripts/copy/snapshot-capabilities.mjs <draftSectionId> <work>/capabilities.json`
     records what the editor accepts per component type. `changedSinceLastSnapshot: true`
     means the editor changed: re-check before deploying.
4. **Build the description:**
   `node scripts/copy/build-description.mjs <work>/source.json <work>/page.desc.json --fonts <ledger> --recipes <work>/recipes.json --source-origin https://<site> --local-origin http://127.0.0.1:8732 --pages '{"https://<site>/":"<homePageId>","https://<site>/<this page>":"<pageId>"}' --name "<Page>" --decorative <img substrings kept in the plate>`
   Deterministic. Read its `review` list: anything it could not decide is there, never guessed.
5. **Prepare media in parallel** (nothing here waits on anything else):
   - `node scripts/copy/import-media.mjs <projectDir> <work>/page.desc.json` imports the
     public images by URL (REST, mint the token first) and writes their uris back.
   - `render-plate.mjs <local url> <work>/plate --cuts full:0:<page.height> --width 1920 --scale 2 --keep …`
     then `upload-media-manager.mjs <anySectionId> <plate>`; put its uri in
     `section.background.plate`.
6. **Check locally until clean:**
   `node scripts/copy/check-description.mjs <work>/page.desc.json <work>/check --capabilities … --fonts … --source <local url> --plate <plate.png> --write`
   It validates every type, style key, link type and value against the snapshot; renders the
   description with the source's own fonts; settles 1–3 px touches and click areas; fails on
   any remaining desktop overlap; diffs the render against the source (expect ~5%: font
   anti-aliasing); stacks the mobile column with measured heights and derives the mobile
   background bands from the plate colour behind each component. Look at
   `check/render-1280.png` and `check/render-390.png`.
7. **Deploy:** `node scripts/copy/deploy-description.mjs <work>/page.desc.json --page <pageId> --clean`
   (`pages.add({ name, addToMenu: false })` creates the page.) About 9 editor calls: setup,
   create in chunks of 10, desktop composition (re-sent until every box lands), pins, mobile
   composition re-stacked from the heights Harmony really gave each text, and an in-editor
   read-back that must report `problemCount: 0`. State is kept in `<desc>.deploy.json`:
   after a fix, re-run without `--clean` (it re-places), or with `--reapply` (it re-sends
   content, styles and links too). A full page took ~35–50 s.
8. **Stage steps (no API):**
   `node scripts/copy/mobile-stage.mjs hide <id…>` for click areas and anything else that must
   not show on mobile, and `node scripts/copy/mobile-stage.mjs bg-opacity <sectionId> 0` so the
   desktop plate does not show on a phone (the band gradient shows instead).
9. **Verify:** `node scripts/copy/preview-widths.mjs http://127.0.0.1:8732/<page> <work>/w --widths 1280,1920,1836,1440,1024,768,390 --scale-check <sectionId>`.
   `scaleDeviations` must be empty. Compare `h-1280.png` with the source at a 46 px offset
   (the free-site banner), masking the floating button. Look at 768 and 390.
10. **Links: every source link is a link in the copy, and none may point back at the source.**
    `measure-source` records every visible link (`anchors`). `build-description` sets text and image links,
    wraps a text that sits inside a link (nav items, "show all") in an inline `<a>`, and turns every other link
    (icons painted in the plate, the logo, social icons, tiles) into a transparent click area over its box.
    Floating elements (a chat pill) are pinned by recipe, never click areas.
    **A link to a store category, a product, or any page the copy replaces MUST go to the new site's own page.**
    Pass `--linkmap links.json`: `{ "<source URL>": { "link": <Harmony link>, "inline": "<absolute URL for text links>" } }`,
    built from the migrated data (the data step's crosswalk and the Stores category/product slugs):
    - category: `{ type: 'PageLink', pageId: <the Stores "Category Page" (pages.list marks it isDynamicPage)>, innerRoute: <category slug> }`.
      `innerRoute` is the slug only: the editor prefixes `/category/` itself (`category/<slug>` gave `/category/category/<slug>`).
    - product: the editor rejects `PageLink` + `innerRoute` for the Stores product page ("Router not found for this page"),
      so use `{ type: 'ExternalLink', url: '<site>/product-page/<product slug>', target: '_self' }`.
    - a link inside rich text cannot be a PageLink: its `inline` is the absolute URL (`<site>/category/<slug>`).
    - a page that is not built (about, policies, contact, account): point it at a page that exists (Home, the cart or account page)
      and mark the entry `"unbuilt": "<why>"`; never leave the source URL. The builder writes every such page to
      `desc.pendingItems` (source URL, the stand-in it points at, the components, responsible role, next action, what resolves
      it): the durable cutover hand-off. A redirect to Home never resolves it; only mapping the source URL to a real page (the
      entry without `unbuilt`) does. `check-description` fails when `pendingItems` is stale and lists each pending page as a
      warning; the deploy report carries them.
    - lookup keys keep the case of the path and query values (`/Product/A` and `/product/a` are different pages) and ignore
      per-visit tracking parameters (`utm_*`, `fbclid`, `gclid`, `_ga`, `mc_*`, `visitorId`) and the fragment.
    `check-description` FAILS while any link still points at the source (`--allow-old-links "<reason>"` only for pages
    deliberately not built yet). After publishing, read every `<a href>` back from the live page, request each category and
    product URL, and confirm status 200, the right title, and products listed. A visitor reaching the old site is a critical bug.
    Slugs can be non-Latin or emoji: the live URL is percent-encoded, the description keeps them readable.
11. **Elements Harmony supplies (cart icon, login):** add them in the description (`build-description --native native.json`,
    `kind: native`) so they land in the same deploy. Never add or remove a component by hand after the deploy: each add or
    remove lets the editor squeeze the page's blank bands (a cart icon or a helper box shifts the page) and the plate
    no longer lines up. Undo/redo in the editor is one step per run, not per call: undoing too far also undoes the header collapse.
    A login bar needs the Members app; it is not an addable component on a blank site.
12. **Local copies of the linked pages:** capture the category and product pages the homepage links to
    (`mirror-site.mjs <dir> <urls...> --widths 1280 --resume`; it saves every 10 pages, so a long list can resume). Pages take
    ~25 s each: split a long list over several output directories and merge the `index.json` files (union of `resources`,
    `pages`, `captured`, copy the `bodies`).

13. **One Harmony section per source section.** A page copied as one big section cannot be edited like a Harmony page, and every
    add or remove squeezes the whole grid. After the deploy, split it: measure the source's top-level blocks (for SFCC
    `.experience-region > .experience-component`, plus header, content asset and footer), list them in a spec and run
    `node scripts/copy/split-sections.mjs <spec.json> --page <pageId> --section <oldSectionId>`
    (spec format in the script header: name, `y0`/`y1` in source pixels, `delta` (Harmony y minus source y), background, videos,
    `place`, `include`, `drop`, `cards`). It keeps every component with its id, style and link, gives each section its own
    background and its own desktop and mobile layout, then removes the old section. Backgrounds: sample each band of the plate;
    a band that is one colour is a section background colour with no image, only a decorated band gets its own plate
    (`render-plate.mjs --width 1280 --scale 2` with one cut per section). For a plate section run
    `mobile-stage.mjs bg-opacity <sectionId> 0` unless the plate survives a phone width, and check each section's mobile height
    (the editor may keep an old tall height: send `setComposition` again). A grid of tiles uses `"cards": true` so a phone shows
    tile by tile instead of all images and then all captions. Set `--redo-mobile "<name>"` to re-send one section. A section whose boxes do not land (desktop or mobile, re-read after every write) is not finished: the run exits 1, keeps the original section and resumes from that section. The final cleanup (drop, remove the original section) runs once all sections are finished, checks what still exists, and is recorded, so a repeat or a mobile redo never touches a deleted section.
14. **Videos are copied as videos.** A source video (Vidyard background player, `<video>`) needs the real mp4: the player's
    JSON lists signed URLs that expire in minutes and answer 403 without `Referer`/`Origin: https://play.vidyard.com` and a
    browser User-Agent, so download them while mapping the page. Upload through Media Manager
    (`upload-media-manager.mjs`; Playwright cannot transfer more than 50 MB per call, so upload a large file alone).
    A half-width video next to text is a `wixEditorElements.VideoUpload` at the measured box (autoplay, loop, muted, no controls);
    a full-width one is the section's background video (`videoMedia`). The video value must be
    `{ uri: 'video/<fileId>/720p/mp4/file.mp4', name, hasAudio, duration, adaptiveSources: [], sources: [{ quality, width, height, types: [{ format: 'mp4', uri }] }], poster: { uri: '<fileId>f002.jpg', name, width, height } }`.
    **`adaptiveSources` must be present, even `[]`.** Without it the saved document cannot be loaded again: the editor stays on the
    loading screen ("Failed to wait for Document Services", `Cannot read properties of undefined (reading 'map')`). Recovery: open the
    editor with Playwright `page.route` on `pages.parastorage.com/sites/*.json` and add `adaptiveSources: []` to the broken video
    items in the response, change the video once and save; a plain reload then works. After a long run, Preview needs ~20 s to render:
    scroll the Preview frame and take viewport shots instead of one full-page screenshot.
15. **A product collection is the Stores slider gallery, never static tiles.** Wherever the source shows a collection (best sellers,
    new, gift picks, related) add the `checkout_Orders.SliderGallery_legacy` object ("Slider Product Gallery") in that section; the
    static images, names and prices are dropped (`drop` in the split spec). It is driven by a Stores category: pick an existing
    category when the source's list matches one, otherwise create one and assign the products found in the source block
    (parse the block's tiles from the local mirror, match the migrated products by exact name or SKU, then
    `POST /categories/v1/categories` and `POST /categories/v1/bulk/categories/<id>/add-items` with
    `appId 215238eb-22a5-4c36-9e7b-e7c08025e04e`). The category cannot be set through `content.set`; open the gallery's
    Settings (`editActions.run({ action: 'chooseSource' })`), "Change Category", search, "Select" (the picker is the iframe
    `ecom.wix.com/storefront/settings-minigallery`). The gallery shows its own title (the category name); set "Gallery title
    alignment" to the source's side and do not add a second heading. Record the category as a cutover item (the source ranks by
    sales, the new store has no sales history yet).

16. **For every area, look for a Wix component first, and match it.** Before an area of the source is rebuilt from text, images and
    a plate, name what it *is* (collection, newsletter signup, contact or booking form, search, login, cart, menu, social icons, map,
    video, gallery, accordion, tabs, repeater) and look for the Wix object that does that job: the addable list
    (`components.listAddable`), the Add panel's Elements search (it also lists app widgets that are not in `listAddable`, such as
    Forms and Popups), and `apps.search` for an app that supplies it. Use the object when one exists and configure it to the
    source (texts, fields, colours, size); build static pieces only for areas with no Wix equivalent, and list those as differences.
    Examples: product collections -> Slider Product Gallery (item 15); videos -> Video Player or a section background video
    (item 14); the cart icon -> Cart Icon (item 11); **a newsletter signup (email, consent checkbox, button) -> the Wix Forms
    "Subscribe" form**. Search the Elements panel for "subscribe" and click the first "Sign Up for Our Newsletter" card with the target
    section selected (`components.select`, then Playwright on Add > Elements). The first use installs Wix Forms ("Adding Wix Forms",
    about 30 s, then `forms.list` shows "Newsletter signup", type `wixForms.Form_legacy`): it is an app install, so say so before
    doing it. Then: `forms.update` for field labels (the form came out in the site's Hebrew, header, consent and button included; the
    header, consent text and button label are not editable through `forms.update`), `appearance.setStyles` on the form's elements
    (`form-background` transparent, `text`, `input`, `submit-button`, `form-container` paddings; the consent line takes
    `text.paragraphColor`), then remove the live texts and the plate drawing the old form, set the section's colour, and compose
    the form in the section (desktop and mobile) with the section height from the form's measured height.
    Record any area you could not match, with the Wix object you looked for and why it was not used.

17. **Find what a visitor can do, not only what the page shows.** A screenshot is one state. Before measuring, run
    `node scripts/copy/find-interactions.mjs <local url> <work>/interactions.json --shots <work>/ix`: with Playwright it lists the
    controls (tabs, accordions and "read more" toggles, carousel arrows, in-page anchors, details/summary), clicks each one from inside
    the page (`el.click()`, so a consent dialog or sticky bar over the control does not block it) and records what each state shows
    (images, links, text, a screenshot). It reports `hiddenPanes`: content that exists only after a click. Every hidden pane must be
    copied, its images fetched from the mirror (the mirror already holds them) and its links mapped like any other. Also look for what
    only appears on hover (mega menus, zoom), scroll (sticky bars, reveal animations), time (rotating banners) or a click on an image
    (quick view, dialogs); click or hover them with Playwright and screenshot each state. Do not call a page copied while any
    control has an unexplained state. Match each kind to a Wix component (item 16): tabs -> Tabs (`wixEditorElements.TabsContainer`),
    accordion -> Accordion, carousel -> Slideshow or the Stores slider gallery, hover or dropdown menu -> Menu, dialog or
    popup -> Popup.
18. **Tabs.** Add `wixEditorElements.TabsContainer` in the section; it comes with 3 tabs. Set the names and count with
    `content.set({ values: { tabs: [{ ...tab, name }, ...] } })` using the tab objects read back (a shorter array removes the
    extra tab). Each tab is an inner container (`components.getTree`): remove its placeholder children, `components.reparent` the
    tab's tiles into it (or add them there), give each tile its link, and place them with `layout.setComposition` on that inner
    container (width = the tabs' width, a tile at the source's column and row; do it for desktop and again in the mobile view). A
    tabs component has no grid of its own: set its x, y and width with the section's `setComposition`, its height follows the
    content. Style `tabContent` (background) and `menuItem` (background, colour, font size, letter spacing, padding, bottom border)
    with `appearance.setStyles`; the active tab's look is the `selected` state: `appearance.changeState({ elementPath: ['menuItem'],
    state: 'selected' })`, set the colour and bottom border, then `changeState` back to `null`. The tab bar's own fill
    (`menu-background` and the other `menu-*` root properties) is rejected by `setStyles` ("must NOT have unevaluated properties"):
    set "Tab container color" in the Design panel (`editActions.run({ action: 'design' })`, Fill colors, the swatch, the hex field).
19. **Check the copy for what is missing, not only for what differs.** A photo that is an `<img>` is hidden from the plate on purpose
    and must be an Image component; one without a component simply vanishes (a photo beside a text block
    was lost until a person saw the empty half). After a deploy, compare each section with the source side by side and list every
    source image, text and control with no counterpart in the copy; fetch the source image from the mirror and upload it. A video file
    can carry black bars of its own (a 16:9 file with a wider picture has bars top and bottom): extract a frame
    (`ffmpeg -ss 3 -i video.mp4 -frames:v 1 frame.png`) and size a cover-fit section to the picture.
    A product image that shows broken in a Stores gallery while its original URL loads is usually a JPEG the image service cannot
    resize (an Adobe RGB profile or EXIF dimensions that disagree with the real size): re-encode it
    (`ffmpeg -i in.jpg -map_metadata -1 -vf scale=W:H -q:v 2 out.jpg`), upload it, and set the product's media with
    `PATCH /stores/v3/products/<id>` including `"fields": ["MEDIA_ITEMS_INFO"]` (without `fields` the update fails with a 500).
    Test every product image with `<url>/v1/fill/w_300,h_300/x.jpg` after an import.

20. **Copy the content, then improve the site.** A copy that reproduces every flaw of the source is not the goal; where Wix gives a
    better result, take it. After the sections are built, review the whole page for what a visitor would notice and fix it:
    - **Site language and direction.** A Hebrew store on a site whose language is English shows "Add to Cart" and a left-to-right
      Stores layout. Set the language (`PATCH /site-properties/v4/properties` with `{"properties":{"language":"he"},"fields":{"paths":["language"]}}`,
      the field mask is an object, a plain array answers "Failed to parse JSON"), reload the editor, publish: the Stores widgets
      come out in Hebrew and mirrored.
    - **Gaps.** Compare each section's content with its height: `layout.getComposition` gives the first content `y` and the last
      bottom. Pull the content to a 48-64 px margin and cut the height to match (the source's dead bands are not worth copying). Do
      it for desktop and re-send the mobile layout afterwards: a desktop re-send also moves the mobile boxes, and a mobile
      `setComposition` can move the desktop ones, so read both views back after every layout write.
    - **Mobile.** Stack a feature as icon, title, text (not all icons, then all titles); a tile with its caption; photo first. Hide
      the click areas that sit over plate icons (`mobile-stage.mjs hide`) and set the mobile height to the last visible bottom + 24.
    - **Readability.** Text on a dark band must be readable in every state (a form's checkbox label takes `input.inputValueColor`).
21. **Store pages are part of the copy.** The Category Page (`checkout_Orders.CategoryPage_legacy`) and Product Page
    (`checkout_Orders.ProductPage_legacy`) are single app widgets: review the source's category and product pages next to them and
    set the widget's styles with `appearance.setStyles` per element (category: `general`, `productGallery`, `productInfo`,
    `headerSection`, `sidePanel`, `pagination`, `loadMorePrevious`; product: `actionButtons`, `productInfo`, `quantity`,
    `infoSections`, `productImages`, `wishlist`) with the brand colours (price, sale price, selected filter and the add-to-cart
    button in the brand colour, the strikethrough price grey). `editActions.run({ action: 'elements' })` opens "Display
    elements": switch the category menu off when it lists every category of a store with many categories. The widgets' header and footer
    are the global ones, which this API cannot fill: copy the home page's header section and footer sections to each store page with
    `components.copy({ componentIds })` on the home page, then `pages.navigate` to the store page and `components.paste()`, then
    `sections.reorder` (a pasted section lands last). Add a collection to the product page with the slider gallery in its own
    section; "Related products" renders empty outside the product widget's own slot, so pick a category.

## Rules for a good, fast copy

1. **Measure, never eyeball.** Every position, size, colour and font comes from
   `source.json`. If a number is missing, extend the measurement, not your guess.
2. **Real fonts or nothing.** Wrong fonts are the most visible difference. Upload the
   source's fonts before placing any text.
3. **Plate the decoration, rebuild the content.** Paper textures, torn edges, gradients,
   photos used as backgrounds and ornaments go in the plate. Text, links and meaningful
   images stay live.
4. **Everything scales or nothing does.** No `px` that survives in the stored data:
   - line heights as `em`;
   - images in `fitWidth`;
   - sections with `height: auto`;
   - no fixed-height header/footer.

   One `px` line height in one button makes the page short at 1920. Run
   `--scale-check` after every batch of style writes.
5. **Overlap-free arrangement.** Harmony rejects the **whole** composition if any two boxes
   overlap, including touching text boxes whose height is `lines × line-height` with
   decimals. Resolve source overlaps by baking the decorative party into the plate or by
   nudging a box 1 px. Never repair drift with `layout.move`.
6. **Text boxes** (build-description does this):
   - single-line: the painted words (`glyphBox`) + 12 px, anchored as aligned (centred text
     stays centred on its words, not on an inline icon beside them);
   - multi-line: the block width, or the run width for a paragraph split around a float;
   - `<br>` stays `<br>`; box top = the first glyph line's top (`lineTop`).
7. **Width differences in a substitute font** are fixed with `letterSpacing` (e.g.
   `-0.4px`), never by shrinking the box below the text.
8. **Mobile: positions, widths and the section height are per view through
   `setComposition` in the mobile view; image heights, sizes from `setSize`, styles and
   backgrounds are shared.** Never send an image height on mobile (the ratio derives it), and
   never style in mobile view. Hide and background-image opacity are stage steps.
9. **Verify in Preview at exact widths, never on the zoomed stage.** Compare images side by
   side and sample pixel colours before calling a colour wrong.
10. **Batch writes, save often, guard publishing.**
    - Batch 10–15 components per snippet, `site.save()` at the end, and record the
      returned ids in a work file.
    - Never re-run a partly failed batch.
    - Check `isPublished` before and after UI automation.
11. **Send the heights Harmony will compute.** Boxes are anchored to the box above them: a
    text sent taller than it renders, an image whose height breaks its ratio, or a Button
    whose height is below its label pulls everything after it up. Text heights come from the
    local render with fonts loaded; image heights from the ratio; a click area's height from
    its label `lineHeight` (em).
12. **Links inside text stay inline `<a href>`.** `links.set` on a rich text rewrites it (root
    becomes `<h1>`, an underline span appears). Strip tracking parameters (`utm_*`,
    `visitorId`, …) from links: they change per visit.
13. **Compare against the offline copy.** A live source can paint popups over itself
    (an order widget opened a modal and made a 90% "difference").
14. **Write down what each new site taught you** (see "Improve the method" below): site
    specifics in your migration folder, generic findings as `dev3 note` for the skill maintainer.

## Starting a new site (checklist)

1. Public data only. Never ask for or use credentials.
2. Create the Harmony site from the blank template. If the source is a store or another app-backed business, stop here and migrate the data first ("Order" above); open the editor for the front end afterwards (SKILL.md).
3. Steps 0–10 below, one page at a time; copy the homepage first so later pages can reuse its
   recipes (nav, footer, fonts).
4. Run `snapshot-capabilities.mjs` once per session and pass it as `--capabilities` to
   `check-description.mjs` and `editor-run.mjs` (or set `HARMONY_CAPABILITIES`): every editor
   call is then linted against the editor's real method list.
5. Read the `review` list of every `build-description` run. It lists what the method cannot
   decide: missing fonts, embeds/video/forms (`unsupported`), floating elements without a
   recipe, default mobile thresholds (`--layout`).
6. Keep customer-specific files (mirror, descriptions, ledgers, screenshots) in the project's
   migration folder, never in `skills/`.

### Dynamic sources (carts, carousels, recommendations, video)

The offline mirror must be proven before measuring (step 0). Pages that load blocks by script
(product carousels, recommendation widgets, JSONP) need the mirror server's replay features:
per-site `--port`, runtime-URL shim, fuzzy lookup that ignores timestamps, visitor ids and
callback names. `check-mirror` refuses a port that serves another site, and reports
`diffOutsideMediaPct`: video and player regions cannot be compared (headless Chromium has no
h264), so the 0.1% gate applies outside them. Run `yarn install` first in a fresh worktree:
the scripts need `playwright`.

### Learned on a fluid, responsive store homepage (RTL)

Result: live components over a full-page plate; desktop scales; mobile is a readable single column;
vertical position can drift toward the bottom of a long page. What to know before the next one:

- **A fluid layout is copied as the 1280 px design, scaled.** Harmony scales the section with the
  viewport; the source re-flows. Match at the design width, say so for 1920 and others.
- **The editor API moved under the scripts.** `components.add` takes `{ containerId, components:
  [{ componentType, box }] }` and returns `added[].componentId`; `layout.setSize` takes plain
  numbers; `fonts.resolve` takes `{ fontFamily }`. `snapshot-capabilities` fails first when it
  moves: run it before anything else.
- **Plate:** render with a normal viewport height and a scroll pass (footers and bands paint on
  scroll), at the design width. Images that overlap text (a photo under a text card) and SVGs
  that cannot be imported as media go in the plate (`--decorative`, `--keep`).
- **Cropped images** (a hero drawn with `object-fit: cover`) need `displayMode: fill` and an
  explicit `setSize`, otherwise composition derives the height from the ratio and the page
  below creeps up. build/postedit marks them when the box ratio differs from the file's by >1.5%.
- **Texts that wrap one line earlier in Harmony** (different glyph widths): widen the box
  (right-aligned text grows to the left; centred symmetrically) or use `letterSpacing`
  (a small negative value fits a link). Find the width in the editor with `layout.setSize` +
  `layout.measure`, then record it. `check-description --heights` takes the editor's measured
  text heights.
- **The section's grid compacts blank vertical bands and loses a few pixels on every
  `setComposition`.** Re-sending does not converge ("resolved back onto the boxes it already
  had" is the fixed point). Transparent spacer images hold the rows (the drift shrinks) but
  their size is shared with mobile and there is no API to hide a component on mobile (the UI
  hide step could not find "Hide" on a 4 px component), so spacers were not kept. Open item.
- **Global header/footer cannot be collapsed through the section API** (they are refs; their
  cart icon and login bar sit on the master page and `setSize` stops at the content height).
- **Chrome can exit mid-run.** Use a per-site `--port`; after a relaunch read the site state (component
  count, plate, `isPublished`) and run `site.save()` before continuing.

### Scope and limits

Proven on a fixed-width, centred 1280 px layout (top nav, header band, main column, right
sidebar). Components other than text, image and button are not rebuilt; embeds, video, forms
and inline SVG are listed, not copied. A responsive theme (no fixed width, no centring) has not
been tried: expect to tune `--layout` and to extend the mobile stacking. Say so in the report
instead of presenting a partial copy as exact.

## Several sites, several agents: one agent per site

A customer migration may run many sites at once. Each site gets **exactly one agent**.
Never put two agents on the same Harmony site, and never split one site's pages between
agents: they would share one editor tab, one set of component ids and one save, and overwrite
each other.

**Per-site isolation** (an agent uses only its own):
- its own Harmony site (msid) and editor tab;
- its own Chrome: set `PW_PORT` to a free port and `WIX_HARMONY_PROFILE_DIR` to a folder
  for this site before `launch.sh`, and use the same `PW_PORT` for every script;
- its own migration folder (mirror, descriptions, ledgers, screenshots, `capabilities.json`).
  Another site's files are never read or edited.

**Brief the agent gets** (the orchestrator fills this in; ask if something is missing):
1. source URL, and the list of pages to copy, homepage first;
2. the Harmony site (msid) and editor URL;
3. the migration folder and the `PW_PORT` / profile folder;
4. the rules: public data only, never publish, never touch the menu or other pages
   unless asked, report in the format below.

**Order inside a site:** homepage first (nav, footer and fonts become recipes), then the
other pages one at a time. Run `snapshot-capabilities.mjs` once per session.

**Stop and ask a human** (`dev3 attention "<question>"`) instead of guessing when: the
source needs a login, a page is mostly embeds/video/forms, the layout is not a fixed-width
centred one (see Scope and limits), or a check keeps failing after a fix. Do not present a
partial copy as exact.

### Hand-off when a site (or page) is done

Write one report in the site's migration folder, and send its path to the orchestrator
(`dev3 message`) with one line of summary. It contains what "Before reporting to the user"
below requires, plus:
- the `openItems` list from `<desc>.deploy-report.json` (links still pointing to the source:
  the cutover operator needs them);
- the draft's save state and that nothing is published;
- what you could not copy (`unsupported`, review items) and any layout assumption you
  changed with `--layout`.

### Improve the method: learnings flow back to the skill

Each site is a test of the method, so what it teaches must reach the next agent.
- **Per site:** keep a `LEARNINGS.md` in the migration folder (what broke, the fix, how you
  noticed). It is customer data, so it stays out of `skills/`.
- **Generic findings** (an editor behavior, a script bug, a missing check, a layout the
  method can't do) go to the skill. Do not edit `skills/` from a site agent; the skill maintainer
  merges them. Record each with `dev3 note add` (one insight per note, no customer names or
  paths) and send the task id to the orchestrator in the hand-off. The maintainer then adds the
  behavior to SKILL.md "Editor behaviors learned live", a technique to this file, or a
  script/lint fix with a test.
- **Before you start:** read the latest SKILL.md and this file, then
  `dev3 conversations search "harmony <topic>"` if you hit something unfamiliar.
- A learning is done when the next agent no longer needs to rediscover it: it is in the
  skill, or a script/check now prevents it.

## Before reporting to the user

State plainly:
- the widths you verified and what each looks like;
- the differences that remain and why (substitute system fonts, hover effects not copied,
  a mobile layout that is readable but not the source's zoomed-out phone view);
- links that point to the old site because the page is not built yet;
- the publication state, and any change to it you did not make on purpose.

## Worked reference: a fixed-width WordPress site

- **Source:** a fixed-width, centred layout (`centeringDx` is half the gap between the
  1920 canvas and the design width). There is no mobile design; on a phone it renders
  zoomed out.
- **Fonts:** display fonts uploaded from Google Fonts; a font already in the catalog is
  mapped by name (for example `courier` to `courier new`), and the floating button takes
  a catalog font with a small negative letter spacing.
- **Desktop:**
  - one auto-height section, `fill` background with a 2x full-page plate;
  - header and footer collapsed;
  - small decorative icons and a promo tag baked into the plate; the tag gets a
    transparent link button;
  - components: nav buttons, linked images, text blocks, a footer rich text with an
    inline link, and the pinned order pill;
  - `scaleDeviations` empty between 1024, 1280 and 1920.
- **Mobile:**
  - same components in a single column, nav in two rows;
  - background-image opacity 0 on mobile, with a band gradient behind it;
  - the promo-tag click area hidden on mobile.
- **Things that went wrong:**
  - a 3-section header/plate/footer copy broke at 1836 (bands scale differently);
  - mobile `setSize`/`setContainerBackground` changed desktop;
  - a `px` line height on a hotspot made the page short at 1920;
  - Preview at 1024 failed until the window was wide enough (slider not rendered).

### A second page through the description pipeline

- Texts (including float runs), images, nav buttons, a click area over a stamp and a pinned
  order button; most components reused from the homepage recipes.
- The local pipeline (measure, build, media, check) takes seconds; a deploy takes a handful of
  editor calls; re-place or re-apply takes seconds. Building the pipeline once makes each
  further page far cheaper than hand work.
- Acceptance: read-back `problemCount: 0`; `scaleDeviations` empty 1024-1920; the pixel
  difference from the source at 1280 reported; mobile a single column with plate-coloured bands.
- Known: a paragraph split around a float reads as two paragraphs on mobile.
