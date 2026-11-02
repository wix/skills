# Wix Business Solution Contexts

Contexts that Wix business solutions (Stores, Blog, Bookings, Events) already provide on Studio Two sites. **Read one of these instead of building a provider that fetches or collects the same data** — the data is already on the page, and the Wix SDK is not the way to get it.

Types and descriptions come from the installed `@wix/*` packages. Open the file for the context you need; it lists every hook, its import specifier, and the properties it returns. A context with a long property list is split across numbered files, all linked in the table.

## Rules

- **Import only the hook, from the specifier listed here.** The specifier is the package path, such as `@wix/stores/context/product`. Never guess one; copy it from the vertical's file.
- **A hook works only inside the area that provides its context** — a page the business solution sets up, a Data Source the Wix user attached, or an item in a list. Anywhere else it throws (see [When the Hook Throws](CONSUMING.md#when-the-hook-throws)).
- **Consume it in an Editor React component or in a provider you write**, as in [Importing a Context in Code](CONSUMING.md#importing-a-context-in-code). A native element reads the vertical's values through Editor Binding instead.
- **The business solution must be installed on the site** (Wix Stores for `@wix/stores/...`). Check the site's installed apps first. If the solution is missing, tell the user to install it and stop. If the platform rejects the code with `Missing dependencies: <id> (@wix/stores/context/<name>) for app <id>`, do not retry, rewrite or delete the context: name the missing dependency in your final message.
- **A specifier exists only in the package version that added it.** Install the vertical package at its latest version before importing, and confirm the specifier: `grep '"./context/<name>"' node_modules/@wix/<vertical>/package.json`. The mandatory `// @ts-ignore` hides a missing export from `tsc` and from `wix build`.
- **Blog renamed `post-item` to `post-list-item`** (hook `usePostListItemContext`) by `@wix/blog` 1.0.708, and added `post-by-slug`, whose `usePostBySlugContext` returns the same properties as `usePostContext`. Use the new names.
- **A hook listed with `optional: true` also has a no-argument form.** The package's own examples call `useServiceContext()`, which returns the value and throws outside its area; `optional: true` returns `null` instead. Read the installed `.d.ts` for the exact overloads.
- **If the vertical's context already holds the field, do not add a settings panel, a data field or an SDK call to collect it again.**

## Index

| Vertical | Specifier | Hooks | Files |
| --- | --- | --- | --- |
| Stores | `@wix/stores/context/category-by-id` | `useCategoryByIdContext` | [category-by-id.md](vertical-contexts/stores/category-by-id.md) |
| Stores | `@wix/stores/context/category-by-slug` | `useCategoryBySlugContext` | [category-by-slug.md](vertical-contexts/stores/category-by-slug.md) |
| Stores | `@wix/stores/context/category-info` | `useCategoryInfoContext` | [category-info.md](vertical-contexts/stores/category-info.md) |
| Stores | `@wix/stores/context/category-list` | `useCategoryListContext` | [category-list.md](vertical-contexts/stores/category-list.md) |
| Stores | `@wix/stores/context/product-by-id` | `useProductByIdContext` | [product-by-id.md](vertical-contexts/stores/product-by-id.md), [product-by-id-2.md](vertical-contexts/stores/product-by-id-2.md), [product-by-id-3.md](vertical-contexts/stores/product-by-id-3.md), [product-by-id-4.md](vertical-contexts/stores/product-by-id-4.md), [product-by-id-5.md](vertical-contexts/stores/product-by-id-5.md), [product-by-id-6.md](vertical-contexts/stores/product-by-id-6.md) |
| Stores | `@wix/stores/context/product-by-slug` | `useProductBySlugContext` | [product-by-slug.md](vertical-contexts/stores/product-by-slug.md), [product-by-slug-2.md](vertical-contexts/stores/product-by-slug-2.md) |
| Stores | `@wix/stores/context/product-item` | `useProductItemContext`, `useProductItemContextValue` | [product-item.md](vertical-contexts/stores/product-item.md), [product-item-2.md](vertical-contexts/stores/product-item-2.md), [product-item-3.md](vertical-contexts/stores/product-item-3.md) |
| Stores | `@wix/stores/context/product-list` | `useProductListContext` | [product-list.md](vertical-contexts/stores/product-list.md), [product-list-2.md](vertical-contexts/stores/product-list-2.md), [product-list-3.md](vertical-contexts/stores/product-list-3.md) |
| Stores | `@wix/stores/context/product` | `useProductContext` | [product.md](vertical-contexts/stores/product.md), [product-2.md](vertical-contexts/stores/product-2.md) |
| Stores | `@wix/stores/context/promotion-item` | `usePromotionItemContext` | [promotion-item.md](vertical-contexts/stores/promotion-item.md) |
| Blog | `@wix/blog/context/blog-feed` | `useBlogFeedContext` | [blog-feed.md](vertical-contexts/blog/blog-feed.md), [blog-feed-2.md](vertical-contexts/blog/blog-feed-2.md) |
| Blog | `@wix/blog/context/category-item` | `useCategoryItemContext` | [category-item.md](vertical-contexts/blog/category-item.md) |
| Blog | `@wix/blog/context/post-by-id` | `usePostByIdContext` | [post-by-id.md](vertical-contexts/blog/post-by-id.md), [post-by-id-2.md](vertical-contexts/blog/post-by-id-2.md) |
| Blog | `@wix/blog/context/post-list-item` | `usePostListItemContext` | [post-list-item.md](vertical-contexts/blog/post-list-item.md) |
| Blog | `@wix/blog/context/post-by-slug` | `usePostBySlugContext` (same properties as `usePostContext`) | [post.md](vertical-contexts/blog/post.md) |
| Blog | `@wix/blog/context/post` | `usePostContext` | [post.md](vertical-contexts/blog/post.md) |
| Blog | `@wix/blog/context/related-posts` | `useRelatedPostsContext` | [related-posts.md](vertical-contexts/blog/related-posts.md) |
| Blog | `@wix/blog/context/tag-item` | `useTagItemContext` | [tag-item.md](vertical-contexts/blog/tag-item.md) |
| Bookings | `@wix/bookings/context/booking-checkout` | `useBookingCheckoutContext` | [booking-checkout.md](vertical-contexts/bookings/booking-checkout.md) |
| Bookings | `@wix/bookings/context/categories` | `useCategoriesContext` | [categories.md](vertical-contexts/bookings/categories.md) |
| Bookings | `@wix/bookings/context/locations` | `useLocationsContext` | [locations.md](vertical-contexts/bookings/locations.md) |
| Bookings | `@wix/bookings/context/service-addons` | `useServiceAddOnsContext` | [service-addons.md](vertical-contexts/bookings/service-addons.md) |
| Bookings | `@wix/bookings/context/service` | `useServiceContext` | [service.md](vertical-contexts/bookings/service.md), [service-2.md](vertical-contexts/bookings/service-2.md), [service-3.md](vertical-contexts/bookings/service-3.md), [service-4.md](vertical-contexts/bookings/service-4.md), [service-5.md](vertical-contexts/bookings/service-5.md) |
| Bookings | `@wix/bookings/context/time-slots` | `useTimeSlotsContext` | [time-slots.md](vertical-contexts/bookings/time-slots.md), [time-slots-2.md](vertical-contexts/bookings/time-slots-2.md), [time-slots-3.md](vertical-contexts/bookings/time-slots-3.md) |
| Bookings | `@wix/bookings/context/services` | `useServicesContext` | [services.md](vertical-contexts/bookings/services.md) |
| Events | `@wix/events/context/event-by-id` | `useEventByIdContext` | [event-by-id.md](vertical-contexts/events/event-by-id.md), [event-by-id-2.md](vertical-contexts/events/event-by-id-2.md), [event-by-id-3.md](vertical-contexts/events/event-by-id-3.md), [event-by-id-4.md](vertical-contexts/events/event-by-id-4.md), [event-by-id-5.md](vertical-contexts/events/event-by-id-5.md), [event-by-id-6.md](vertical-contexts/events/event-by-id-6.md) |
| Events | `@wix/events/context/event-by-slug` | `useEventBySlugContext` | [event-by-slug.md](vertical-contexts/events/event-by-slug.md), [event-by-slug-2.md](vertical-contexts/events/event-by-slug-2.md), [event-by-slug-3.md](vertical-contexts/events/event-by-slug-3.md) |
| Events | `@wix/events/context/event-item` | `useEventItemContext` | [event-item.md](vertical-contexts/events/event-item.md), [event-item-2.md](vertical-contexts/events/event-item-2.md), [event-item-3.md](vertical-contexts/events/event-item-3.md) |
| Events | `@wix/events/context/event-list` | `useEventListContext` | [event-list.md](vertical-contexts/events/event-list.md) |
| Events | `@wix/events/context/registration` | `useRegistrationContext` | [registration.md](vertical-contexts/events/registration.md) |
| Events | `@wix/events/context/event` | `useEventContext` | [event.md](vertical-contexts/events/event.md), [event-2.md](vertical-contexts/events/event-2.md), [event-3.md](vertical-contexts/events/event-3.md) |
| Events | `@wix/events/context/seating` | `useSeatingContext` | [seating.md](vertical-contexts/events/seating.md) |
| Events | `@wix/events/context/thank-you` | `useThankYouContext` | [thank-you.md](vertical-contexts/events/thank-you.md), [thank-you-2.md](vertical-contexts/events/thank-you-2.md), [thank-you-3.md](vertical-contexts/events/thank-you-3.md), [thank-you-4.md](vertical-contexts/events/thank-you-4.md) |
