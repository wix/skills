# Blog context: `@wix/blog/context/tag-item`

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/blog/context/tag-item`.

### `TagItemContextProvider`

Supplies one post tag, injected per repeater cell, to its children.

```ts
import { TagItemContextProvider } from '@wix/blog/context/tag-item';
```

- **Parameters:** `__0: TagItemContextProviderProps`
- **Returns:** `ReactNode`

### `useTagItemContext`

Nullable rather than throwing: the hook runs for every element inside the repeater cell, including on the editor stage before the cell is populated.

```ts
import { useTagItemContext } from '@wix/blog/context/tag-item';
```

- **Parameters:** none
- **Returns:** `PostTagItem \| null`

#### Returned types

##### `TagItemContextProviderProps`

| Property | Type | Description |
| --- | --- | --- |
| `tagData` | `PostTagItem \| undefined` | The current item of the `postTags` array, injected by the platform per repeater cell (the Post context manifest's `contextImplementor.propKey`). Absent on the editor's unbound template cell — children then render over a null context, matching the Category Item and Post Item providers; this provider has no standalone fetch path. |
| `children` | `ReactNode` |  |

##### `PostTagItem`

| Property | Type | Description |
| --- | --- | --- |
| `_id` | `string` | The tag's ID. |
| `label` | `string` | The tag's name, as plain text. |
| `itemTagLabel` | `RichText` | The tag's name, as rich text: `text` is the plain text, and `html` is an HTML paragraph. |
| `itemTagLink` | `Link \| undefined` | Link to the blog page that lists the tag's posts, with its URL in `href`. `undefined` when the site has no such page. |
| `tagItem` | `{ label: string; slug: string; }` | The tag's name and slug. |
