# Data Collection — permissions

> Split out of [DATA_COLLECTION.md](../DATA_COLLECTION.md). The scaffolded `dataPermissions` are
> placeholders; set them from this file before shipping.

## Permissions

Access levels control who can read, create, update, and delete items in collections.

| Level                | Description                                        |
| -------------------- | -------------------------------------------------- |
| `UNDEFINED`          | Not set (inherits defaults)                        |
| `ANYONE`             | Public access (including visitors)                 |
| `SITE_MEMBER`        | Any signed-in user (members and collaborators)     |
| `SITE_MEMBER_AUTHOR` | Signed-in users, but members only access own items |
| `CMS_EDITOR`         | Site collaborators with CMS Access permission      |
| `PRIVILEGED`         | CMS administrators and privileged users            |

**Common patterns:**

- Public content (default, recommended): `read: ANYONE, write: PRIVILEGED`
- User-generated content: `read: SITE_MEMBER, write: SITE_MEMBER_AUTHOR`
- Editorial workflow: `read: ANYONE, write: CMS_EDITOR`
- Private/admin: `read: PRIVILEGED, write: PRIVILEGED`

**Permission hierarchy** (most to least restrictive): `PRIVILEGED` > `CMS_EDITOR` > `SITE_MEMBER_AUTHOR` > `SITE_MEMBER` > `ANYONE` > `UNDEFINED`

### Context-Based Permission Rules

**CRITICAL: Permissions must match where and how the data is accessed.** The consumer of the data determines the minimum permission level — setting permissions more restrictive than the access context will cause runtime failures (empty results or permission-denied errors).

**Determine permissions by asking: "Who interacts with this data, and from where?"**

| Access Context | Who Sees / Uses It | Implication |
|---|---|---|
| **Custom element widget** (`CUSTOM_ELEMENT_WIDGET`) | Any site visitor (public) | Reads must be `ANYONE`. If the widget accepts input (e.g., reviews, submissions), inserts must also be `ANYONE` or `SITE_MEMBER`. |
| **Embedded Script** | Any site visitor (public) | Same as custom element widget — reads must be `ANYONE`. Writes depend on whether visitors can submit data. |
| **Dashboard Page** (`DASHBOARD_PAGE`) | Site owner / collaborators only | Can use `CMS_EDITOR` or `PRIVILEGED` for all operations since only authorized users access the dashboard. |
| **Backend code (site-side)** | Runs in visitor context | If called from page code or site-side modules, the caller has visitor-level permissions — data must be readable/writable at the appropriate public level. |
| **Backend code (elevated)** | Runs with `auth.elevate()` from `@wix/essentials` | Can bypass permissions, but the collection still needs correct defaults for any non-elevated callers. |

Use `SITE_MEMBER_AUTHOR` on `itemUpdate` / `itemRemove` when members should only modify their **own** items (e.g., a member can edit only their own reviews).

**How to apply this:**

1. **Identify every place the collection is read or written** — custom element widgets, dashboard pages, embedded scripts, backend APIs.
2. **Use the least restrictive context as the floor.** If a custom element widget reads the data AND a dashboard page also reads it, `itemRead` must be `ANYONE` (because the widget is public).
3. **Apply per-operation.** A collection can have `itemRead: ANYONE` (widget displays it) but `itemInsert: CMS_EDITOR` (only dashboard users add items). Each operation is independent.
