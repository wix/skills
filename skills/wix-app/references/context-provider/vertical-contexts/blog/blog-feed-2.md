# Blog context: `@wix/blog/context/blog-feed` (part 2 of 2)

This context's reference is split across 2 files: [blog-feed.md](blog-feed.md), [blog-feed-2.md](blog-feed-2.md).

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/blog/context/blog-feed`.

##### `VisualMedia`

| Property | Type | Description |
| --- | --- | --- |
| `src` | `string` | The URL of the media file |
| `slug` | `string \| undefined` | The slug for the media |
| `description` | `string \| RichText \| undefined` | Description of the media for accessibility purposes |
| `title` | `string \| RichText \| undefined` | The title of the media |
| `height` | `number \| undefined` | The height of the media in pixels |
| `width` | `number \| undefined` | The width of the media in pixels |
| `action` | `{ link: string \| Link; } \| undefined` | An action when the item is clicked |
| `type` | `"image" \| "video"` |  |
| `parameters` | `ImageParameters \| VideoParameters \| undefined` |  |

##### `EmptyStateLabels`

| Property | Type | Description |
| --- | --- | --- |
| `title` | `string` | Heading to show in place of the empty list, in the site's language. |
| `description` | `string` | Sentence to show under the heading, in the site's language. |

##### `FilteredFeedView`

| Property | Type | Description |
| --- | --- | --- |
| `kind` | `"pending" \| "all" \| "category" \| "tag"` | Loading state, while the first page of posts loads. Also `'pending'` when the posts failed to show, with `hasError` set to `true`. Unfiltered feed. The URL isn't a category or tag page. Also `'all'` when no category or tag matches the URL, and the feed is then empty, and when the first page of posts failed to load. Category's posts, on a category page such as `/blog/category/<slug>`. Tag's posts, on a tag page such as `/blog/tag/<slug>`. |
