# Blog context: `@wix/blog/context/post-list-item`

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/blog/context/post-list-item`.


### `PostItemContextProvider`

Supplies one blog post, injected per repeater cell, to its children.

```ts
import { PostItemContextProvider } from '@wix/blog/context/post-list-item';
```

- **Parameters:** `__0: PostItemContextProviderProps`
- **Returns:** `ReactNode`

### `usePostListItemContext`

Nullable rather than throwing: the hook runs for every element inside the repeater cell, including on the editor stage before the cell is populated.

```ts
import { usePostListItemContext } from '@wix/blog/context/post-list-item';
```

- **Parameters:** none
- **Returns:** `PostItemContextType \| null`

#### Returned types

##### `PostItemContextProviderProps`

| Property | Type | Description |
| --- | --- | --- |
| `postData` | `PostListItem \| undefined` | The current item of the `postsList` array, injected by the platform per repeater cell (the Post List manifest's `contextImplementor.propKey`). Absent on the editor's unbound template cell — the three-way branch below matches the bookings builder's service-context: item → publish it; no item → render children over nulls (the nullable hook is the "null fields"); this provider has no standalone fetch path. |
| `children` | `ReactNode` |  |

##### `PostItemContextType`

| Property | Type | Description |
| --- | --- | --- |
| `_id` | `string` | Post ID. |
| `title` | `string` | Post's title, as plain text. |
| `itemTitle` | `RichText` | Post's title, as rich text. Its `text` field holds the plain text, and its `html` field holds the text as an HTML paragraph. |
| `itemExcerpt` | `RichText` | Post's excerpt, as rich text. Empty when the post has no excerpt. |
| `itemCoverImage` | `Image \| undefined` | Post's cover image, with its URL, size, and alt text. For a post whose cover is a video uploaded to Wix, the video's poster image. `undefined` when there's no image to show, such as when the cover is an embedded video. It holds the cover image even when the post's author hid the cover. To leave out a hidden cover, check `itemCoverMedia`, which is `undefined` then. |
| `itemCoverMedia` | `CoverMedia \| undefined` | Post's cover as an image or a playable video. Use it to play a video cover, which `itemCoverImage` holds only as its poster image. `undefined` when the post has no cover, or the post's author hid it. |
| `itemLink` | `Link \| undefined` | Link to the post's page. `href` is the page's URL, and `target` is `'_self'`, so the link opens in the same tab. `undefined` when the post has no slug and no URL. |
| `itemPublishedDate` | `RichText` | Date the post was first published, as rich text in the site's regional format. In the week after publishing, it's relative, such as "3 days ago". After that, it's a date, such as "Aug 5", with the year when it isn't the current year. |
| `publishedDateValue` | `string \| undefined` | Date the post was first published, as an [ISO 8601](https://en.wikipedia.org/wiki/ISO_8601) string. `undefined` when the post has no publish date. |
| `clockValue` | `number` | Current time that `itemPublishedDate` is relative to, in milliseconds since the Unix epoch. When you format `publishedDateValue` as a relative date yourself, use this value as the current time, so your text matches `itemPublishedDate`. |
| `minutesToReadValue` | `number \| undefined` | Estimated reading time, in minutes. `undefined` when the post has no estimate. |
| `initialViewCount` | `number \| undefined` | Number of times the post was viewed, as loaded with the post. `undefined` when the count wasn't loaded with the post. In the editor, but not in Preview, a sample number instead. |
| `initialCommentCount` | `number \| undefined` | Number of comments on the post, as loaded with the post. `undefined` when the count wasn't loaded with the post. In the editor, but not in Preview, a sample number instead. |
| `authorName` | `RichText` | Name of the post's author, as rich text. Empty when the author isn't found. |
| `authorImage` | `Image \| undefined` | Author's profile photo, with its URL, size, and alt text. The alt text is the author's name, or a generic author-photo label when the author has no name. `undefined` when the author has no photo. |
| `timeToRead` | `RichText` | Estimated reading time as rich text in the site's language, such as "5 min read". Empty when the post has no estimate. |
| `viewCount` | `RichText` | Number of views as rich text in the site's language, such as "1,234 views". Empty when the count wasn't loaded with the post. In the editor, but not in Preview, a sample count instead. |
| `commentCount` | `RichText` | Number of comments as rich text in the site's language. Empty when the count wasn't loaded with the post. In the editor, but not in Preview, a sample count instead. |
| `itemCategoryLabel` | `RichText` | Name of the post's main category, as rich text. It's the first of the post's categories that still exists. Empty when none of the post's categories exists. In the editor, but not in Preview, a sample name instead. |
| `recentPostItem` | `{ title: string; slug: string; }` | Post's title and slug, as plain text. |
| `commentingEnabled` | `boolean \| undefined` | Whether site visitors can comment on the post. `undefined` when it isn't known, such as for the sample posts in the editor. |
| `isLiked` | `boolean` |  |
| `isLikeCountLoaded` | `boolean` | False while the fresh like-count read is in flight (always false on SSR) — the Counters widget renders a skeleton instead of a possibly-stale number until it flips. A skipped read (editor, preview, no post id) and a failed read both settle to true with the baked count, so the skeleton never outlives its fetch. |
| `toggleLike` | `(pointerEvent?: PointerEvent \| undefined) => Promise<void>` |  |
| `liveLikes` | `LiveLikes` | The same like state, live: updated synchronously, while the fields above update in a transition. Stable identity — publish it on the context value as is. |
| `likeCountValue` | `number` | The raw counters for widgets (Counters reads `likeCountValue`). Named apart from the bindable richText labels `likeCount` / `viewCount` / `commentCount`, which `PostListItem` already carries and this provider overrides once the per-cell metadata read resolves. |
| `viewCountValue` | `number \| undefined` |  |
| `commentCountValue` | `number \| undefined` |  |
| `likeCount` | `RichText` |  |

##### `CoverMedia`

| Property | Type | Description |
| --- | --- | --- |
| `kind` | `"image" \| "wixVideo" \| "embed"` | Image cover. Cover video uploaded to Wix. Cover video embedded from another site, such as YouTube. |
