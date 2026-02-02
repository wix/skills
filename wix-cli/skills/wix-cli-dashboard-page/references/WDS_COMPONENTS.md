# WDS Components Reference

List of supported Wix Design System components for dashboard pages.

## Supported Components

The following Wix Design System components are the ONLY components you are allowed to use. Do not use any other components from '@wix/design-system'.

**Note:** Component details (descriptions, features, examples) are dynamically generated from the Wix Design System storybook. The list below shows all supported component names.

## Component List

- AutoComplete
- Badge
- Box
- Button
- IconButton
- TextButton
- Card
- Card.Content
- Card.Divider
- Card.Header
- Card.Subheader
- Cell
- Checkbox
- ColorInput
- CornerRadiusInput
- CustomModalLayout
- Divider
- Dropdown
- EmptyState
- FormField
- Heading
- IconButton
- Input
- InputArea
- Layout
- Loader
- MarketingLayout
- MessageModalLayout
- Modal
- NestableList
- NumberInput
- Page
- Page.Footer
- Page.Header
- Page.Section
- RichTextInputArea
- SectionHeader
- SidePanel
- Table
- TableActionCell
- TableListHeader
- TableListItem
- TableToolbar
- TagList
- Text
- TextButton
- TimeInput
- Tooltip
- ToggleSwitch

## Usage Restrictions

- Use ONLY WDS components that are explicitly listed above
- Do NOT use components from @wix/wix-ui-icons-common unless you know the correct import path and it's explicitly needed for icons
- Always verify component availability before using it in your generated code
- If you need a component not in the list, use a basic HTML element or create a simple custom component instead

When generating code, use the component names exactly as listed above and import them from '@wix/design-system'.
