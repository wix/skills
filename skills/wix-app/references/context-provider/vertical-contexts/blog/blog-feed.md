# Blog context: `@wix/blog/context/blog-feed` (part 1 of 2)

This context's reference is split across 2 files: [blog-feed.md](blog-feed.md), [blog-feed-2.md](blog-feed-2.md).

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/blog/context/blog-feed`.

### `PostListProvider`

Loads a page of blog posts, filtered by the URL view or the picked category or posts, and supplies them as a feed.

```ts
import { PostListProvider } from '@wix/blog/context/blog-feed';
```

- **Parameters:** `__0: { children?: ReactNode; categoryPicker?: CategoryPickerFilter \| undefined; postsPicker?: PostPickerFilter \| undefined; pageSize?: number \| undefined; postOffset?: number \| undefined; sortOrder?: string \| undefined; featuredOnly?: boolean \| undefined; liveRefreshGeneration?: number \| undefined; }`
- **Returns:** `ReactNode`

### `useBlogFeedContext`

The Blog Feed context provides access to a list of the site's published blog posts, loaded a page at a time. Use it to show posts, load more of them, and show the feed's empty, loading, and error states.

```ts
import { useBlogFeedContext } from '@wix/blog/context/blog-feed';
```

- **Parameters:** none
- **Returns:** `PostListContextType`

#### Returned types

##### `PostListContextType`

| Property | Type | Description |
| --- | --- | --- |
| `postsList` | `PostListItem[]` | Posts in the feed, one item per post, in the order the feed shows them. The list starts with the first page of posts, and `loadMorePosts()` adds each later page to its end. It's empty while the first page loads, and when the first page failed to load. In the editor, but not in Preview, the list holds three sample posts to design with when the feed has no posts, the page isn't a category or tag page, and none of the **Category**, **Posts**, and **Featured Posts Only** settings is set. Preview and the live site show the empty list. |
| `postGalleryItems` | `VisualMedia[]` | Posts in the feed as gallery media items, in the same order as `postsList`. Each item holds the post's cover image or video, the post's title and excerpt, and a link to the post's page. Posts with no cover, or whose author hid the cover, are left out. A post whose cover is an embedded video, such as a YouTube video, appears as the video's thumbnail image, and is left out when the video has no thumbnail. In the editor, but not in Preview, the list holds three sample items to design with when no post in the feed has a cover, the page isn't a category or tag page, and none of the **Category**, **Posts**, and **Featured Posts Only** settings is set. |
| `emptyState` | `EmptyStateLabels \| null` | Title and description to show in place of the posts when the feed has no posts, in the site's language. `null` while the feed has posts, while the first page of posts loads, and when posts failed to load. In the editor, it's set for an empty feed even while `postsList` holds sample posts, so check that `postsList` is empty before you show it. |
| `hasError` | `boolean` | Whether posts failed to load. While it's `true`, `emptyState` is `null`, so show an error message instead of a message that the blog has no posts. A failed `loadMorePosts()` call sets it to `true` and keeps the posts already loaded. The next successful `loadMorePosts()` call sets it back to `false`. When the first page of posts failed to load, `hasMorePosts` is `false`, so `loadMorePosts()` does nothing and `hasError` stays `true`. Reloading the page tries again. |
| `hasMorePosts` | `boolean` | Whether `loadMorePosts()` can load more posts. `false` when the feed shows hand-picked posts, because they all load at once. When the number of posts is an exact multiple of the number loaded at a time, it stays `true` until a `loadMorePosts()` call finds no more posts. Also `false` while the first page of posts loads, and when it failed to load. |
| `isLoadingPosts` | `boolean` | Whether posts are loading. `true` while the first page of posts loads, and while `loadMorePosts()` loads another page. |
| `loadMorePosts` | `() => Promise<void>` | Loads the next page of posts and adds it to the end of `postsList` and `postGalleryItems`. A page holds the number of posts set in the **Posts** Data Source's **Posts Per Load** setting, up to 100, or 6 when it isn't set. Does nothing when `hasMorePosts` is `false`. A call made while a page is loading returns the promise of the call in progress, so each page loads once. When the page fails to load, the promise still resolves. `hasError` becomes `true`, and the next call tries the same page again. |
| `filteredView` | `FilteredFeedView` | View of the feed that the page's URL shows, with the category's or tag's details. It's all posts, one category, or one tag. It's set from the URL when the first page of posts loads, and doesn't change when `loadMorePosts()` loads more posts. |

##### `PostListItem`

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
