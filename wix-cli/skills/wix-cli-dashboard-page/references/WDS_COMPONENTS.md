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

## Querying Component Details

For detailed information about each component (descriptions, features, usage examples, do's and don'ts), use the query script to extract information from the WDS storybook JSON.

### Using the Query Script

The WDS component data is stored in `assets/wds-storybook.json`. To query detailed information about specific components, use the query script:

```bash
# From any skill directory, run:
node scripts/query-wds-components.js <component-name> [<component-name> ...]

# Examples:
node scripts/query-wds-components.js Button
node scripts/query-wds-components.js Button Card Input
node scripts/query-wds-components.js Page Page.Header Page.Content
```

The script outputs formatted component information including:

- Component description
- Category
- Do's and don'ts (usage guidelines)
- Feature examples with code snippets

### JSON Structure

The JSON file (`assets/wds-storybook.json`) contains an array of component objects with the following structure:

- `storyName` (string): The component name (e.g., "Button", "Card", "Page")
- `category` (string, optional): Component category (e.g., "Components/Actions")
- `content.description` (string, optional): HTML-formatted component description
- `content.do` (string[], optional): Array of recommended usage patterns
- `content.dont` (string[], optional): Array of usage anti-patterns to avoid
- `content.featureExamples` (array, optional): Array of feature examples with:
  - `title` (string): Feature name
  - `description` (string): HTML-formatted feature description
  - `example` (string): TypeScript/React code example

**Note:** Component names in the JSON are case-sensitive and must match exactly (e.g., "Button" not "button").

### When to Query Components

Query component details when you need:

- Specific prop usage examples
- Best practices and anti-patterns
- Feature-specific code examples
- Detailed component descriptions

When generating code, use the component names exactly as listed above and import them from '@wix/design-system'.
