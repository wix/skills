# Blog context: `@wix/blog/context/post-by-id` (part 2 of 2)

This context's reference is split across 2 files: [post-by-id.md](post-by-id.md), [post-by-id-2.md](post-by-id-2.md).

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/blog/context/post-by-id`.

##### `PostCategoryItem`

| Property | Type | Description |
| --- | --- | --- |
| `_id` | `string` | The category's ID. |
| `label` | `string` | The category's name, as plain text. |
| `itemCategoryLabel` | `RichText` | The category's name, as rich text: `text` is the plain text, and `html` is an HTML paragraph. |
| `itemCategoryLink` | `Link \| undefined` | Link to the blog page that lists the category's posts, with its URL in `href`. `undefined` when the site has no such page. |
| `categoryItem` | `{ label: string; slug: string; }` | The category's name and slug. |

##### `PostTagItem`

| Property | Type | Description |
| --- | --- | --- |
| `_id` | `string` | The tag's ID. |
| `label` | `string` | The tag's name, as plain text. |
| `itemTagLabel` | `RichText` | The tag's name, as rich text: `text` is the plain text, and `html` is an HTML paragraph. |
| `itemTagLink` | `Link \| undefined` | Link to the blog page that lists the tag's posts, with its URL in `href`. `undefined` when the site has no such page. |
| `tagItem` | `{ label: string; slug: string; }` | The tag's name and slug. |

##### `LiveLikes`

| Property | Type | Description |
| --- | --- | --- |
| `get` | `() => LiveLikeSnapshot` | Retrieves the current like state and counts. |
| `subscribe` | `(listener: () => void) => () => void` | Calls a listener each time the like state or the counts change. |

##### `RelatedPostsSource`

| Property | Type | Description |
| --- | --- | --- |
| `currentPostId` | `string \| undefined` | The post's ID. `undefined` when there's no post. |
| `categoryIds` | `string[] \| undefined` | IDs of the categories the post belongs to. `undefined` when there's no post. |
| `relatedPostIds` | `string[] \| undefined` | Writer-curated related posts (max 3, ordered as set in the Blog dashboard). |
