# Blog context: `@wix/blog/context/related-posts`

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/blog/context/related-posts`.

### `RelatedPostsProvider`

Loads the posts related to the current post and supplies them to its children.

```ts
import { RelatedPostsProvider } from '@wix/blog/context/related-posts';
```

- **Parameters:** `__0: { children?: ReactNode; postsCount?: number \| undefined; }`
- **Returns:** `ReactNode`

### `useRelatedPostsContext`

The Related Posts context provides access to a list of blog posts related to the current post. Use it to show related posts, and the list's empty, loading, and error states.

```ts
import { useRelatedPostsContext } from '@wix/blog/context/related-posts';
```

- **Parameters:** none
- **Returns:** `RelatedPostsContextType`

#### Returned types

##### `RelatedPostsContextType`

| Property | Type | Description |
| --- | --- | --- |
| `relatedPosts` | `PostListItem[]` | Posts related to the current post. When the current post's writer picked related posts for it, and at least one of them still exists, these are the picked posts that still exist, in the order the writer picked them. Otherwise, they're the most recently published posts in the site's language that share a category with the current post, newest first. When the current post has no categories, they're the blog's most recently published posts in the site's language. The current post is never one of them. Limited to the number in the **Related Posts** Data Source's **Number of Posts** setting, up to 12. When the setting is empty, limited to 3. Empty while the posts load for the first time, and when they fail to load. To tell those apart from a post with no related posts, check `isLoadingRelatedPosts` and `hasError`. In the editor, but not in Preview, it holds sample posts whenever there are no posts to show, including when they fail to load, but not when an error stops them from rendering. |
| `emptyState` | `EmptyStateLabels \| null` | Text to show in place of the list when the current post has no related posts. `null` while the posts load, when they fail to load, and when there are related posts. In the editor, but not in Preview, it's also set while `relatedPosts` holds sample posts, unless the posts failed to load. |
| `isLoadingRelatedPosts` | `boolean` | Whether the related posts are loading for the first time. When the current post changes, it stays `false`, and `relatedPosts` keeps the previous post's related posts until the new ones load. |
| `hasError` | `boolean` | Whether the related posts failed to load. When it's `true`, `emptyState` is `null`, so show an error message rather than an empty state. `relatedPosts` is empty, except after a failed load in the editor, but not in Preview, where it holds sample posts. |
| `hasRelatedPosts` | `boolean` | Whether there are related posts to show: `true` exactly when `relatedPosts` isn't empty. `false` while the posts load for the first time, when they fail to load, and when the current post has no related posts. In the editor, but not in Preview, it's `true` while `relatedPosts` holds sample posts. |
