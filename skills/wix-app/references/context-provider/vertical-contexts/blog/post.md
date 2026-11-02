# Blog context: `@wix/blog/context/post`

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/blog/context/post`.

`@wix/blog/context/post-by-slug` exports the same properties as `usePostBySlugContext` (provider `PostBySlugProvider`); read them here.

### `PostProvider`

Supplies the current blog post: the one a parent context hands down, or the post page's own.

```ts
import { PostProvider } from '@wix/blog/context/post';
```

- **Parameters:** `__0: PostProviderProps`
- **Returns:** `ReactNode`

### `usePostContext`

Reads the current post from the nearest Post context provider; throws outside one.

```ts
import { usePostContext } from '@wix/blog/context/post';
```

- **Parameters:** none
- **Returns:** `PostContextType`

#### Returned types

##### `PostProviderProps`

| Property | Type | Description |
| --- | --- | --- |
| `children` | `ReactNode` |  |
| `value` | `PostContextType \| undefined` | A post resolved by another provider that lists this one in its manifest `refContexts` — published as-is, with no fetch, SEO, view count or translation redirect: those belong to the post page. Without it this provider is the post page's own (`PostBySlugProvider`). The same hybrid as wixstores' `category-info-context-provider`: a value-only base would blank every live post page, which has this provider attached and relies on it fetching. A caller with nothing to show must still pass a value (an empty one), or this falls back to fetching the page's slug. |

##### `PostContextType`

| Property | Type | Description |
| --- | --- | --- |
| `title` | `RichText` | The post's title, as rich text: `title.text` is the plain text, and `title.html` is the same text in an HTML paragraph. |
| `excerpt` | `RichText` | A short summary of the post, as rich text. To check whether there is one, use `hasExcerpt`. |
| `coverImage` | `Image \| undefined` | The post's cover image, or the poster image of its video cover, as an `Image` from `@wix/editor-react-types`. `undefined` when the post has neither. It holds the image even when the post's author hid the cover, so check `hasCoverImage` before you show it. |
| `richContent` | `RichContent` | The post's full body, as a Ricos rich content document. Show it with a rich content viewer. When the post is for paying subscribers only and the site visitor can't read all of it, the body ends where the free part ends, followed by the post's paywall message. |
| `authorName` | `RichText` | The display name of the post's author, as rich text. |
| `authorImage` | `Image \| undefined` | The profile picture of the post's author, as an `Image` from `@wix/editor-react-types`. `undefined` when the author has none. |
| `timeToRead` | `RichText` | The post's estimated reading time with its unit, such as `3 min read`, as rich text in the site's language. Empty when the post has no estimate. |
| `publishedDate` | `RichText` | The date the post was first published, as rich text in the site's regional format: a relative date in the last week, such as `3 days ago`, and the calendar date after that, such as `May 12`, with the year when it isn't the current year, such as `May 12, 2024`. |
| `viewCount` | `RichText` | The post's view count with its unit, such as `340 views`, as rich text. Empty when there's no count to show. |
| `commentCount` | `RichText` | The post's comment count with its unit, such as `4 comments`, as rich text. Empty when there's no count to show. |
| `likeCount` | `RichText` | The post's like count with its unit, such as `12 likes`, as rich text. Includes a like or unlike from `toggleLike()`. Empty when there's no count to show. |
| `postCategories` | `PostCategoryItem[]` | The categories the post belongs to, in the post's order. Empty when it has none. |
| `postTags` | `PostTagItem[]` | The post's tags, in the post's order. Empty when it has none. |
| `hasCoverImage` | `boolean` | Whether the post shows a cover image, or a video cover with a poster image. `false` when the post's author hid the cover. `true` in the editor when there's no post, so that sample content stays visible. |
| `hasExcerpt` | `boolean` | Whether the post has an excerpt that isn't empty. `true` in the editor when there's no post. |
| `hasTags` | `boolean` | Whether the post has at least one tag. `true` in the editor when there's no post. |
| `publishedDateValue` | `string \| undefined` | The date and time the post was first published, as an ISO 8601 string. `undefined` when there's no date to show. To format it as a relative date, use `clockValue` as the current time. |
| `minutesToReadValue` | `number \| undefined` | The post's estimated reading time, in minutes. `undefined` when the post has no estimate. |
| `viewCountValue` | `number \| undefined` | The post's view count. `undefined` when there's no count to show. Updates when the current count loads in the browser. |
| `commentCountValue` | `number \| undefined` | The number of comments on the post. `undefined` when there's no count to show. Updates when the current count loads in the browser. |
| `isLiked` | `boolean` | Whether the site visitor liked the post. `false` until the visitor's like state loads in the browser. Changes when you call `toggleLike()`. To read the change without delay, use `liveLikes`. |
| `likeCountValue` | `number` | Number of likes the post has, including a like or unlike from `toggleLike()`. Until `isLikeCountLoaded` is `true`, this is the count the page rendered with, which can be out of date, or `0` when that count isn't available. For the count with its unit, such as `12 likes`, use `likeCount`. |
| `isLikeCountLoaded` | `boolean` | Whether `likeCountValue` is final. `false` on the server, and in the browser while the current count loads. `true` once the count loads or fails to load, and when there's no count to load, such as when there's no post or in the editor's Preview mode. It stays `false` after an error that stops the post from rendering. `isEmpty` is then `true`, so check `isEmpty` first. |
| `toggleLike` | `(pointerEvent?: PointerEvent \| undefined) => Promise<void>` | Likes the post for the site visitor, or removes their like if they already liked it. `isLiked`, `likeCountValue`, and `likeCount` change, and so do the values of other components on the page that show the same post. If saving the change fails, they change back. In the editor's Preview mode, the change isn't saved. Does nothing when there's no post, or while a previous call is still saving. |
| `liveLikes` | `LiveLikes \| undefined` | The site visitor's like state and the post's counts, without delay. `isLiked`, `likeCountValue`, `isLikeCountLoaded`, `viewCountValue`, and `commentCountValue` update in a React transition, so they can lag behind while other parts of the page are still loading. To show changes without that delay, read the values with `liveLikes.get()`, and listen for changes with `liveLikes.subscribe()`. `undefined` while the post loads, and after an error that stops the post from rendering. |
| `clockValue` | `number` | The time `publishedDate` measures relative dates from, such as `3 days ago`, in milliseconds since the Unix epoch. When you format `publishedDateValue` yourself, use it as the current time, so that your text matches `publishedDate`. `0` while the post loads. |
| `postUrl` | `string \| undefined` | Absolute URL of the post's page on the site, such as for a share button. `undefined` when there's no URL to share, such as while the post loads or when there's no post. |
| `relatedPostsSource` | `RelatedPostsSource` | IDs used to pick the posts related to this post: the post's own ID, its category IDs, and the related posts its author chose. The object stays the same when the like state changes, so you can use it as an effect dependency. |
| `isLoadingPost` | `boolean` | Whether the post is still loading. While it's `true`, the other properties are empty. Use it to show a placeholder instead of empty content. |
| `hasError` | `boolean` | Whether an error stopped the post from rendering. When it's `true`, the properties don't hold the post's content, and `isEmpty` is `true`. A post that fails to load isn't an error: `hasError` is `false`, and `isEmpty` is `true`, except in the editor, but not in Preview, where the properties hold sample values. |
| `isEmpty` | `boolean` | Whether there's no post to show, such as when the Wix user hasn't chosen a post in the **Selected Post** Data Source's settings, or the chosen post isn't published or couldn't be loaded. Use it to hide the component, instead of showing empty text and a `0` count. `false` while the post loads. Also `false` in the editor outside Preview mode, where the properties hold sample values, unless an error stopped the post from rendering. |
