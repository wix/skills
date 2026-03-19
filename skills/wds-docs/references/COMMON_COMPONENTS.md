# WDS Common Components Cheat Sheet

Quick-reference for the ~20 most-used components. Use this **first** before falling back to the full docs.

All imports: `import { ComponentName } from '@wix/design-system';`
All icons: `import { IconName } from '@wix/wix-ui-icons-common';`

---

## Page

Compound: `<Page.Header>`, `<Page.Content>`, `<Page.Tail>`, `<Page.Section>`, `<Page.Footer>`

| Prop | Type | Notes |
|------|------|-------|
| `height` | string | Use `"100vh"` or `"calc(100vh - 48px)"` for BM pages |
| `maxWidth` | number | Default 1248. Excludes padding. |
| `minWidth` | number | Default 864. |
| `sidePadding` | number | Default 48px. |

`<Page.Header>` key props: `title` (string), `subtitle` (string), `actionsBar` (ReactNode — put buttons here), `breadcrumbs` (ReactNode).

```tsx
<Page height="calc(100vh - 48px)">
  <Page.Header title="Products" actionsBar={<Button prefixIcon={<Add />}>Add Product</Button>} />
  <Page.Content>
    {/* content here */}
  </Page.Content>
</Page>
```

---

## Button

| Prop | Type | Values |
|------|------|--------|
| `skin` | ButtonSkin | `'standard'` \| `'destructive'` \| `'premium'` \| `'light'` \| `'transparent'` \| `'inverted'` \| `'ai'` |
| `priority` | ButtonPriority | `'primary'` \| `'secondary'` |
| `size` | ButtonSize | `'tiny'` \| `'small'` \| `'medium'` \| `'large'` |
| `prefixIcon` | IconElement | `<Add />` etc. |
| `suffixIcon` | IconElement | |
| `fullWidth` | boolean | 100% parent width |
| `disabled` | boolean | |
| `as` | string \| Component | Render as `'a'`, `'div'`, etc. |

```tsx
<Button skin="destructive" priority="secondary" prefixIcon={<Delete />}>
  Remove
</Button>
```

---

## Box

Layout wrapper with flex support. **Use SP tokens for gap/padding/margin.**

| Prop | Type | Notes |
|------|------|-------|
| `direction` | `'horizontal'` \| `'vertical'` | Default: `'horizontal'` |
| `align` | `'left'` \| `'center'` \| `'right'` \| `'space-between'` | X-axis |
| `verticalAlign` | `'top'` \| `'middle'` \| `'bottom'` \| `'space-between'` | Y-axis |
| `gap` | BoxCssSizingProperty | Use `"SP1"`–`"SP6"` |
| `padding` | BoxCssSizingProperty | Use `"SP1"`–`"SP6"` |
| `margin` | BoxCssSizingProperty | Use `"SP1"`–`"SP6"` |
| `width` | BoxCssSizingProperty | |
| `height` | BoxCssSizingProperty | |
| `backgroundColor` | string | Color palette key or hex |

SP tokens: SP1=6px, SP2=12px, SP3=18px, SP4=24px, SP5=30px, SP6=36px

```tsx
<Box direction="vertical" gap="SP4" padding="SP3">
  <Box align="space-between" verticalAlign="middle">
    <Text>Left</Text>
    <Button>Right</Button>
  </Box>
</Box>
```

---

## Text

| Prop | Type | Values |
|------|------|--------|
| `size` | TextSize | `'tiny'` \| `'small'` \| `'medium'` |
| `weight` | TextWeight | `'thin'` \| `'normal'` \| `'bold'` |
| `skin` | TextSkin | `'standard'` \| `'error'` \| `'success'` \| `'premium'` \| `'disabled'` |
| `secondary` | boolean | Lighter font color |
| `light` | boolean | For dark backgrounds |
| `ellipsis` | boolean | Truncate with tooltip |
| `maxLines` | number | Multi-line truncation |
| `tagName` | string | Render as `'span'`, `'p'`, `'div'`, etc. |

```tsx
<Text size="small" weight="bold" skin="error">Required field</Text>
```

---

## Heading

| Prop | Type | Values |
|------|------|--------|
| `size` | Size | `'extraLarge'` \| `'large'` \| `'medium'` \| `'small'` \| `'extraSmall'` \| `'tiny'` |
| `as` | string | HTML tag: `'h1'`–`'h6'`, `'div'`, etc. |
| `light` | boolean | For dark backgrounds |
| `ellipsis` | boolean | Truncate with tooltip |

> **Deprecated:** `appearance` prop — use `size` instead.

```tsx
<Heading size="medium" as="h2">Section Title</Heading>
```

---

## Card

Compound: `<Card.Header>`, `<Card.Subheader>`, `<Card.Content>`, `<Card.Divider>`

| Prop | Type | Notes |
|------|------|-------|
| `controls` | ReactNode | Top-right controls (e.g., CloseButton) |
| `stretchVertically` | boolean | Fill container height |
| `showShadow` | boolean | Drop shadow |
| `hideOverflow` | boolean | Clip overflow |

`<Card.Header>` props: `title` (string), `subtitle` (string), `suffix` (ReactNode).

```tsx
<Card>
  <Card.Header title="Details" suffix={<TextButton>Edit</TextButton>} />
  <Card.Divider />
  <Card.Content>
    <Box direction="vertical" gap="SP3">
      {/* form fields */}
    </Box>
  </Card.Content>
</Card>
```

---

## Table

| Prop | Type | Notes |
|------|------|-------|
| `data` | array | Each item needs `id` (used as React key) |
| `columns` | array | `{ title, render: (row) => ReactNode }` — see below |
| `onRowClick` | func | Enables row hover effect |
| `onSortClick` | func | `(column, sortDescending) => void` |
| `showSelection` | boolean | Checkbox column |
| `selectedIds` | array \| `'ALL'` | Selected row IDs |
| `onSelectionChanged` | func | `(type, change?) => void` |
| `skin` | enum | `'standard'` \| `'neutral'` |
| `rowVerticalPadding` | enum | `'large'` \| `'medium'` \| `'small'` \| `'tiny'` |
| `showHeaderWhenEmpty` | boolean | Show titlebar with no data |
| `horizontalScroll` | boolean | |

Column object: `{ title: string, render: (row) => ReactNode, width?: string, align?: string, sortable?: boolean, sortDescending?: boolean, stickyActionCell?: boolean }`

Compound: `<Table.Content />` (required), `<Table.Titlebar />`, `<Table.SubToolbar>`

```tsx
<Table data={items} columns={columns} onSortClick={handleSort}>
  <TableToolbar>
    <TableToolbar.ItemGroup position="start">
      <TableToolbar.Item>
        <TableToolbar.Title>Products</TableToolbar.Title>
      </TableToolbar.Item>
    </TableToolbar.ItemGroup>
    <TableToolbar.ItemGroup position="end">
      <TableToolbar.Item>
        <Search value={search} onChange={e => setSearch(e.target.value)} />
      </TableToolbar.Item>
    </TableToolbar.ItemGroup>
  </TableToolbar>
  <Table.Content />
</Table>
```

---

## TableToolbar

Compound: `<TableToolbar.ItemGroup>`, `<TableToolbar.Item>`, `<TableToolbar.Title>`, `<TableToolbar.Label>`, `<TableToolbar.Divider>`, `<TableToolbar.SelectedCount>`

`<TableToolbar.ItemGroup>` prop: `position` — `'start'` | `'end'`

```tsx
<TableToolbar>
  <TableToolbar.ItemGroup position="start">
    <TableToolbar.Item><TableToolbar.Title>Items</TableToolbar.Title></TableToolbar.Item>
  </TableToolbar.ItemGroup>
  <TableToolbar.ItemGroup position="end">
    <TableToolbar.Item><Search /></TableToolbar.Item>
  </TableToolbar.ItemGroup>
</TableToolbar>
```

---

## TableActionCell

**IMPORTANT:** `secondaryActions` require an `icon` prop (ReactNode). This is **required**, not optional.

| Prop | Type | Notes |
|------|------|-------|
| `primaryAction` | object \| array | `{ text, onClick?, visibility?, prefixIcon?, suffixIcon?, skin? }` |
| `secondaryActions` | array | `{ text, icon, onClick, skin?, disabled? }` — **icon is required** |
| `numOfVisibleSecondaryActions` | number | Show N as icon buttons outside menu |
| `alwaysShowSecondaryActions` | boolean | Visible without hover |
| `moreActionsTooltipText` | string | Tooltip for "..." button. Recommended: `"More actions"` |
| `size` | enum | `'medium'` \| `'small'` |

Secondary actions use **Small** icon variants in the popover menu.

```tsx
<TableActionCell
  primaryAction={{ text: 'Edit', onClick: () => handleEdit(row) }}
  secondaryActions={[
    { text: 'Duplicate', icon: <DuplicateSmall />, onClick: () => handleDuplicate(row) },
    { text: 'Delete', icon: <DeleteSmall />, onClick: () => handleDelete(row), skin: 'destructive' },
  ]}
  numOfVisibleSecondaryActions={0}
  moreActionsTooltipText="More actions"
/>
```

---

## Modal + CustomModalLayout

**Always use together.** `<Modal>` is the overlay; `<CustomModalLayout>` is the content.

### Modal

| Prop | Type | Notes |
|------|------|-------|
| `isOpen` | boolean | **Required.** Controls visibility |
| `onRequestClose` | func | Called on overlay click / Escape |
| `shouldCloseOnOverlayClick` | boolean | Default: true |
| `screen` | enum | `'full'` \| `'desktop'` \| `'mobile'` |

### CustomModalLayout

| Prop | Type | Notes |
|------|------|-------|
| `title` | string \| ReactNode | **Required** |
| `content` | ReactNode | **Required** (children also work) |
| `primaryButtonText` | string \| ReactNode | |
| `primaryButtonOnClick` | func | |
| `primaryButtonProps` | ButtonProps | Use `{ disabled: true }` to disable |
| `secondaryButtonText` | string \| ReactNode | |
| `secondaryButtonOnClick` | func | |
| `secondaryButtonProps` | ButtonProps | |
| `closeButtonProps` | `{ onClick }` | **Preferred** — see deprecated below |
| `width` | string \| number | Min: 510px, max: 1254px |
| `maxHeight` | string \| number | |
| `removeContentPadding` | boolean | For Table/Page inside modal |
| `sideActions` | ReactNode | Footer start (e.g., checkbox) |
| `footnote` | ReactNode | Bottom text |
| `theme` | enum | `'standard'` \| `'premium'` \| `'destructive'` |
| `showHeaderDivider` | enum | `'auto'` \| `true` \| `false` |
| `showFooterDivider` | enum | `'auto'` \| `true` \| `false` |

> **Deprecated:** `onCloseButtonClick` — use `closeButtonProps={{ onClick: handler }}` instead.
> **Deprecated:** `onHelpButtonClick` — use `helpButtonProps={{ onClick: handler }}` instead.
> **NOT a prop:** `disablePrimaryButton` — use `primaryButtonProps={{ disabled: true }}` instead.

```tsx
<Modal isOpen={isOpen} onRequestClose={onClose} shouldCloseOnOverlayClick>
  <CustomModalLayout
    title="Add Item"
    primaryButtonText="Save"
    primaryButtonOnClick={handleSave}
    primaryButtonProps={{ disabled: !isValid }}
    secondaryButtonText="Cancel"
    secondaryButtonOnClick={onClose}
    closeButtonProps={{ onClick: onClose }}
    content={
      <Box direction="vertical" gap="SP4">
        <FormField label="Name" required>
          <Input value={name} onChange={e => setName(e.target.value)} />
        </FormField>
      </Box>
    }
  />
</Modal>
```

---

## MessageModalLayout

For short confirmation/warning messages. Same deprecated props as CustomModalLayout.

| Prop | Type | Notes |
|------|------|-------|
| `title` | ReactNode | |
| `content` | ReactNode | Short message |
| `illustration` | ReactNode | 120x120 image/icon |
| `primaryButtonText` | ReactNode | |
| `primaryButtonOnClick` | func | |
| `primaryButtonProps` | ButtonProps | |
| `secondaryButtonText` | ReactNode | |
| `secondaryButtonOnClick` | func | |
| `closeButtonProps` | object | **Preferred over deprecated `onCloseButtonClick`** |
| `skin` | enum | `'standard'` \| `'premium'` \| `'destructive'` |

> **Deprecated:** `onCloseButtonClick` — use `closeButtonProps={{ onClick: handler }}`.
> **Deprecated:** `onHelpButtonClick` — use `helpButtonProps={{ onClick: handler }}`.

```tsx
<Modal isOpen={showConfirm} onRequestClose={onClose}>
  <MessageModalLayout
    title="Delete item?"
    content="This action cannot be undone."
    primaryButtonText="Delete"
    primaryButtonOnClick={handleDelete}
    secondaryButtonText="Cancel"
    secondaryButtonOnClick={onClose}
    closeButtonProps={{ onClick: onClose }}
    skin="destructive"
  />
</Modal>
```

---

## Input

| Prop | Type | Notes |
|------|------|-------|
| `value` | string \| number | |
| `onChange` | ChangeEventHandler | Standard React onChange |
| `placeholder` | string | |
| `disabled` | boolean | |
| `readOnly` | boolean | |
| `status` | InputStatus | `'error'` \| `'warning'` \| `'loading'` |
| `statusMessage` | ReactNode | Tooltip on status icon |
| `size` | InputSize | `'small'` \| `'medium'` \| `'large'` |
| `prefix` | ReactNode | Before input |
| `suffix` | ReactNode | After input |
| `clearButton` | boolean | Show X |
| `onClear` | func | |
| `type` | string | `'text'` \| `'password'` \| `'number'` etc. |
| `min` | **number** | **NOT string — use `min={0}` not `min="0"`** |
| `max` | **number** | **NOT string** |
| `step` | **number** | **NOT string** |
| `maxLength` | number | |
| `border` | enum | `'standard'` \| `'round'` \| `'bottomLine'` \| `'none'` |

```tsx
<Input
  value={email}
  onChange={e => setEmail(e.target.value)}
  placeholder="Enter email"
  status={error ? 'error' : undefined}
  statusMessage={error}
/>
```

---

## NumberInput

**Prefer over `<Input type="number">`** for numeric values.

| Prop | Type | Notes |
|------|------|-------|
| `value` | number | |
| `onChange` | `(value: number, stringValue: string) => void` | **Different from Input!** |
| `min` | **number** | |
| `max` | **number** | |
| `step` | number \| number[] | |
| `placeholder` | string | |
| `disabled` | boolean | |
| `hideStepper` | boolean | Hide +/- buttons |
| `prefix` | ReactNode | |
| `suffix` | ReactNode | |
| `status` | InputStatus | `'error'` \| `'warning'` \| `'loading'` |
| `statusMessage` | ReactNode | |
| `strict` | boolean | |

```tsx
<NumberInput
  value={price}
  onChange={(val) => setPrice(val)}
  min={0}
  step={0.01}
  prefix={<Input.Affix>$</Input.Affix>}
/>
```

---

## InputArea (Textarea)

| Prop | Type | Notes |
|------|------|-------|
| `value` | string | |
| `onChange` | ChangeEventHandler | |
| `placeholder` | string | |
| `rows` | number | Initial visible rows |
| `maxLength` | number | |
| `hasCounter` | boolean | Show char count |
| `resizable` | boolean | |
| `autoGrow` | boolean | |
| `minRowsAutoGrow` | number | |
| `maxRowsAutoGrow` | number | |
| `status` | InputStatus | |
| `statusMessage` | ReactNode | |
| `disabled` | boolean | |

```tsx
<InputArea
  value={description}
  onChange={e => setDescription(e.target.value)}
  placeholder="Enter description"
  rows={3}
  maxLength={500}
  hasCounter
  resizable
/>
```

---

## FormField

Wrapper for form inputs. Provides label, status, and char count.

| Prop | Type | Notes |
|------|------|-------|
| `label` | ReactNode | |
| `required` | boolean | Shows asterisk |
| `status` | StatusType | `'error'` \| `'warning'` |
| `statusMessage` | ReactNode | Below input |
| `infoContent` | ReactNode | Tooltip on info icon |
| `charCount` | number | Max length counter |
| `id` | string | Connects label to input via `for` |
| `labelPlacement` | enum | `'top'` \| `'right'` \| `'left'` |
| `stretchContent` | boolean | Child fills available space |

```tsx
<FormField label="Email" required status={error ? 'error' : undefined} statusMessage={error}>
  <Input value={email} onChange={e => setEmail(e.target.value)} />
</FormField>
```

---

## Dropdown

| Prop | Type | Notes |
|------|------|-------|
| `options` | array | `{ id, value }` — id is required and unique |
| `selectedId` | string \| number | Controlled |
| `initialSelectedId` | string \| number | Uncontrolled |
| `onSelect` | func | `(option) => void` |
| `placeholder` | string | |
| `disabled` | boolean | |
| `status` | enum | `'error'` \| `'warning'` \| `'loading'` |
| `statusMessage` | ReactNode | |
| `size` | enum | `'small'` \| `'medium'` \| `'large'` |
| `clearButton` | boolean | |

```tsx
<Dropdown
  options={[
    { id: '1', value: 'Option A' },
    { id: '2', value: 'Option B' },
  ]}
  selectedId={selected}
  onSelect={opt => setSelected(opt.id)}
  placeholder="Choose..."
/>
```

---

## Search

| Prop | Type | Notes |
|------|------|-------|
| `value` | string | |
| `onChange` | func | Standard input onChange |
| `onClear` | func | |
| `placeholder` | string | Default varies |
| `debounceMs` | number | Debounce onChange |
| `options` | array | Dropdown suggestions (same as Dropdown) |
| `expandable` | boolean | Collapse to icon, expand on click |
| `expandWidth` | string \| number | Width when expanded |
| `size` | enum | `'small'` \| `'medium'` \| `'large'` |

```tsx
<Search
  value={searchTerm}
  onChange={e => setSearchTerm(e.target.value)}
  onClear={() => setSearchTerm('')}
  placeholder="Search..."
/>
```

---

## Badge

| Prop | Type | Values |
|------|------|--------|
| `skin` | BadgeSkin | `'general'` \| `'standard'` \| `'danger'` \| `'success'` \| `'neutral'` \| `'neutralLight'` \| `'warning'` \| `'warningLight'` \| `'urgent'` \| `'neutralStandard'` \| `'neutralSuccess'` \| `'neutralDanger'` \| `'premium'` \| `'ai'` |
| `type` | BadgeType | `'solid'` \| `'outlined'` \| `'transparent'` |
| `size` | BadgeSize | `'tiny'` \| `'small'` \| `'medium'` |
| `prefixIcon` | IconElement | |
| `suffixIcon` | IconElement | |
| `uppercase` | boolean | |

```tsx
<Badge skin="success" size="small">Active</Badge>
<Badge skin="danger" type="outlined">Out of Stock</Badge>
```

---

## EmptyState

| Prop | Type | Notes |
|------|------|-------|
| `title` | ReactNode | |
| `subtitle` | ReactNode | |
| `image` | string \| ReactNode | URL or component |
| `children` | ReactNode | Below subtitle (buttons etc.) |
| `align` | enum | `'start'` \| `'center'` |
| `skin` | enum | `'page'` \| `'section'` |

```tsx
<EmptyState
  title="No items yet"
  subtitle="Create your first item to get started."
>
  <TextButton prefixIcon={<Add />}>Add Item</TextButton>
</EmptyState>
```

---

## Layout + Cell

Grid layout system.

| Layout Prop | Type | Notes |
|-------------|------|-------|
| `cols` | number | Grid columns (default: 12) |
| `gap` | CSS gap | Default: 24px |
| `justifyItems` | CSS justifyItems | |
| `alignItems` | CSS alignItems | |

| Cell Prop | Type | Notes |
|-----------|------|-------|
| `span` | number | Columns to span (default: 12) |

```tsx
<Layout cols={12} gap="24px">
  <Cell span={6}>
    <FormField label="First Name"><Input /></FormField>
  </Cell>
  <Cell span={6}>
    <FormField label="Last Name"><Input /></FormField>
  </Cell>
  <Cell span={12}>
    <FormField label="Email"><Input /></FormField>
  </Cell>
</Layout>
```

---

## ToggleSwitch

| Prop | Type | Notes |
|------|------|-------|
| `checked` | boolean | |
| `onChange` | func | |
| `disabled` | boolean | |
| `size` | enum | `'small'` \| `'medium'` \| `'large'` |
| `skin` | enum | `'standard'` \| `'success'` \| `'error'` |

```tsx
<ToggleSwitch checked={enabled} onChange={() => setEnabled(!enabled)} size="small" />
```

---

## Tooltip

| Prop | Type | Notes |
|------|------|-------|
| `content` | ReactNode | Tooltip text |
| `children` | ReactNode | Trigger element |
| `placement` | Placement | `'top'` \| `'bottom'` \| `'left'` \| `'right'` etc. |
| `enterDelay` | number | ms before show |
| `exitDelay` | number | ms before hide |
| `maxWidth` | string \| number | |
| `appendTo` | AppendTo | `'window'` \| `'scrollParent'` \| `'viewport'` \| `'parent'` |
| `disabled` | boolean | |

```tsx
<Tooltip content="Delete this item" placement="top">
  <IconButton><Delete /></IconButton>
</Tooltip>
```

---

## Loader

| Prop | Type | Notes |
|------|------|-------|
| `size` | LoaderSize | `'tiny'` \| `'small'` \| `'medium'` \| `'large'` |
| `color` | LoaderColor | `'blue'` \| `'white'` |
| `text` | ReactNode | Message below loader |
| `status` | LoaderStatus | `'loading'` \| `'success'` \| `'error'` |
| `statusMessage` | string | Tooltip on hover |

```tsx
<Loader size="small" />
<Loader size="medium" text="Loading data..." />
```

---

## TextButton

For secondary/inline actions.

| Prop | Type | Notes |
|------|------|-------|
| `size` | enum | `'tiny'` \| `'small'` \| `'medium'` |
| `weight` | enum | `'thin'` \| `'normal'` |
| `skin` | enum | `'standard'` \| `'light'` \| `'premium'` \| `'destructive'` \| `'dark'` |
| `prefixIcon` | IconElement | |
| `suffixIcon` | IconElement | |
| `underline` | enum | `'none'` \| `'onHover'` \| `'always'` |
| `as` | string \| Component | |
| `disabled` | boolean | |

```tsx
<TextButton size="small" prefixIcon={<Edit />}>Edit</TextButton>
```

---

## IconButton

| Prop | Type | Notes |
|------|------|-------|
| `size` | enum | `'tiny'` \| `'small'` \| `'medium'` \| `'large'` |
| `skin` | enum | `'standard'` \| `'inverted'` \| `'light'` \| `'transparent'` \| `'premium'` |
| `priority` | enum | `'primary'` \| `'secondary'` |
| `disabled` | boolean | |
| `children` | ReactNode | Icon component |

```tsx
<IconButton size="small" priority="secondary"><MoreSmall /></IconButton>
```
