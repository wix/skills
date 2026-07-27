
# Extending a Wix Vertical in the Editor

Start here whenever the goal is to **add functionality to a site page owned by a Wix business solution** (Wix Stores, Bookings, Events, Blog, eCommerce) — a badge on the product page, a note on the service page, an upsell in checkout.

## First: which surface of the vertical?

"Extend Wix Stores" is ambiguous. Route by **where the extension appears**, not by which vertical it touches:

| The extension appears on | Surface | Go to |
| --- | --- | --- |
| A vertical's **site page**, seen by site visitors | Editor / site | **This file** |
| A vertical's **dashboard page**, seen by the site owner | Dashboard | [`DASHBOARD_PLUGIN.md`](DASHBOARD_PLUGIN.md) |
| A vertical's dashboard **more-actions / bulk-actions menu** | Dashboard | [`DASHBOARD_MENU_PLUGIN.md`](DASHBOARD_MENU_PLUGIN.md) |

Only the site/editor surface has the two-architecture problem below. Dashboard plugins are a single extension type across all editors — there is no dual-build requirement there, and they get host data through `observeState()` and typed host props instead of contexts or slot props.

The rest of this file is **editor/site only**. Per-extension mechanics live in [`SITE_PLUGIN.md`](SITE_PLUGIN.md) and [`editor-react-component/CONSUMING-A-VERTICAL.md`](editor-react-component/CONSUMING-A-VERTICAL.md).

---

## The two-surface rule

Within the editor, there is no single extension type that extends a vertical across all Wix editors. The two page architectures are disjoint:

| Editor | Vertical page architecture | Extension type to build |
| --- | --- | --- |
| Wix Editor (Classic), Wix Studio | OOI widgets with **slots** | **Site Plugin** |
| Wix Harmony (and Studio 2 as it rolls out) | Builder: **Context Providers + Editor React Components** | **Editor React Component** |

**You must build both to cover all editors.** This is not a style preference — the platform offers no runtime fallback:

> "Editor React Component extensions are built for Wix Harmony... They're not supported on Wix Editor or Wix Studio sites, and **there's no way to conditionally switch between extension types based on the editor**."
> — [Editor React Component Extension Files and Code](https://dev.wix.com/docs/build-apps/develop-your-app/develop-an-app-with-the-cli/supported-extensions/site/editor-react-components/editor-react-component-extension-files-and-code)

Co-existence is a known open problem on the platform side. The current approach is dev-center **specs that show/hide extensions per editor group**, which is not self-serve — raise it in `#editor-platform-dev` before assuming a single app version can ship both cleanly.

Same shape as [`STORES_VERSIONING.md`](STORES_VERSIONING.md), where an app must support both Stores V1 and V3 or break on some sites.

### Which editors support Editor React Components

The public docs (quoted above) say Harmony **only**. Wix's internal Builder architecture guide scopes it to "Studio 2 & Harmony." Verify against the target site when the difference affects a decision, rather than assuming either.

---

## Coverage checklist

Before calling an editor-side vertical extension "done":

- [ ] A **Site Plugin** exists, with `placements` for every relevant slot — including **both** Stores product-page versions where applicable (see [`site-plugin/SLOTS.md`](site-plugin/SLOTS.md)).
- [ ] An **Editor React Component** exists that reads the same data from the vertical's context (see [`editor-react-component/CONSUMING-A-VERTICAL.md`](editor-react-component/CONSUMING-A-VERTICAL.md)).
- [ ] Both surfaces produce the **same** user-visible behaviour from the same underlying data.
- [ ] The ERC survives being placed **outside** the vertical's page — the context hook throws when no provider is present, so this needs an error boundary or a guaranteed provider, not a null check. See [`editor-react-component/CONSUMING-A-VERTICAL.md`](editor-react-component/CONSUMING-A-VERTICAL.md) Rule 4.
- [ ] The user has been told, under "🔧 Manual Steps Required", that two extensions ship for one feature and why.

---

## What to share, what to keep per-surface

Factor into a shared module (e.g. `src/lib/<feature>/`):

- Data shaping and derivation — "is this product a best seller?", price formatting, date formatting.
- TypeScript types for the feature's own domain.
- Backend calls, and the copy/i18n strings.

Keep separate, because the two hosts are genuinely different:

| Concern | Site Plugin | Editor React Component |
| --- | --- | --- |
| Where it renders | `slotId` in the extension config | Context attached to page/section; user places the component |
| How it gets vertical data | Slot props (`productId`, `eventId`, …) | Context hook (`useProductContext()`, …) |
| Settings UI | Hand-written `.panel.tsx` | Generated auto-panels from the manifest |
| Styling | Custom element / panel fields | CSS Modules + manifest CSS properties |

The data channel is the part that cannot be shared — write a thin per-surface adapter that pulls the host's identifiers, then hand off to the shared module.

---

## Escape hatch: an ERC plugin inside a not-yet-migrated OOI host

If the host vertical has **not** migrated to Builder but you want to ship ERC-based UI into its OOI slot, there is a legacy adapter that wraps a slot placeholder in a context provider:

```tsx
function OOIWidget({ someContainer1, someContainer2 }) {
  const [ProductSlotPlaceholder] = useSlotPlaceholder('product-page-slot-1');
  return (
    <ContextProviderFactory
      moduleName="@wix/stores-smth/product-context"
      providerProps={{ productVariant, productId }}
    >
      <ProductSlotPlaceholder />
    </ContextProviderFactory>
  );
}
```

**Treat this as a last resort.** Per the Builder guide it is "only meant for ERC-plugin developers who need to remain compatible with non-migrated OOI host apps," is **not SSR-compatible yet**, and is intended only until the hosting app migrates. Do not reach for it as the default path — build the two surfaces above instead.

---

## Routing

| You need to | Go to |
| --- | --- |
| Build the classic-editor surface | [`SITE_PLUGIN.md`](SITE_PLUGIN.md) |
| Know which slots a vertical offers | [`site-plugin/SLOTS.md`](site-plugin/SLOTS.md) |
| Build the Harmony surface | [`editor-react-component/CONSUMING-A-VERTICAL.md`](editor-react-component/CONSUMING-A-VERTICAL.md) |
| Know what data a vertical's context exposes | [`editor-react-component/CONSUMING-A-VERTICAL.md`](editor-react-component/CONSUMING-A-VERTICAL.md) — per-vertical catalog |
| General ERC authoring rules | [`EDITOR_REACT_COMPONENT.md`](EDITOR_REACT_COMPONENT.md) |
| Extend a vertical's **dashboard** instead | [`DASHBOARD_PLUGIN.md`](DASHBOARD_PLUGIN.md) / [`DASHBOARD_MENU_PLUGIN.md`](DASHBOARD_MENU_PLUGIN.md) |
