---
name: "Find and Manage Site Members"
description: "Finds a site's members and manages their access: one member by login email or name, the list of members with their emails, status and join dates, how many members a site has, pending, approved and blocked members, approving a pending member, blocking or unblocking a member, adding a member, and changing the name a member shows on the site. Covers which member fields can be filtered, the fieldsets that return email and status, and the member ID other tasks need. Use when the user asks whether someone is a member, wants to see or count their site members, approve a join request, block or unblock someone, add a member, or needs a member's ID for a task other than writing a blog post."
---

# Find and Manage Site Members

A site member is a person who signed up to the site and can log in to its members area. Every member is also a contact, but most contacts are not members. To find a person who may not be a member, search contacts instead, as in [Find Contacts](find-contacts.md): `POST https://www.wixapis.com/contacts/v5/contacts/search` with `{"search": {"search": {"expression": "Jane Doe", "mode": "AND"}}}`; each result in `contacts[]` has `memberInfo.memberId` only when the contact is a member.

All calls go to the [Members API](https://dev.wix.com/docs/api-reference/crm/members-contacts/members/member-management/members/introduction). **Every request below is complete and was run on a live site: send it as written, with your own values, and do not look up the method schema first.** The steps already give each field these calls need: the `fieldsets` value (`FULL`), the filter fields and operators (Step 2), the response fields (Step 3), the empty `{}` body of Approve and Block, and the `member.profile.nickname` body of Update Member, which needs no `id`, `revision` or field mask (Step 4). Reading is safe. Approving, blocking, adding and renaming change the site: Step 4 says when to ask the user first.

## Step 1: Always ask for the FULL fieldset

Members calls return the `PUBLIC` fieldset by default. It has no `loginEmail`, and it returns `status` as `UNKNOWN`. Send `"fieldsets": ["FULL"]` in a query body, or `fieldsets=FULL` in a URL, whenever the answer needs the email or the status.

## Step 2: Find members

`POST https://www.wixapis.com/members/v1/members/query`

| The user gives | Query Members body |
|---|---|
| A login email | `{"query": {"filter": {"loginEmail": "jane@example.com"}}, "fieldsets": ["FULL"]}` |
| A first and last name | `{"query": {"filter": {"contact.firstName": "Jane", "contact.lastName": "Doe"}}, "fieldsets": ["FULL"]}` |
| A name shown on the site ("Syam K") | `{"query": {"filter": {"profile.nickname": "Syam K"}}, "fieldsets": ["FULL"]}` |
| A partial name ("syam") | `{"search": {"expression": "syam", "fields": ["contact.firstName", "contact.lastName", "profile.nickname"]}, "fieldsets": ["FULL"]}` |
| Pending, approved or blocked members | `{"query": {"filter": {"status": "PENDING"}}, "fieldsets": ["FULL"]}` |
| Members who joined in a period | `{"query": {"filter": {"$and": [{"createdDate": {"$gte": "2026-10-01T00:00:00Z"}}, {"createdDate": {"$lt": "2026-11-01T00:00:00Z"}}]}}, "fieldsets": ["FULL"]}`. One object with both `$gte` and `$lt` is rejected with `400` |
| A contact ID | `{"query": {"filter": {"contactId": "<contact id>"}}, "fieldsets": ["FULL"]}` |

**The filter fields.** Query Members filters on these fields, with these operators:

| Field | Operators |
|---|---|
| `loginEmail`, `contact.firstName`, `contact.lastName`, `profile.nickname`, `profile.slug`, `contactId`, `id` | `$eq`, `$in`, `$startsWith` |
| `status` (`PENDING`, `APPROVED`, `BLOCKED`, `OFFLINE`) | `$eq`, `$ne`, `$in` |
| `createdDate` | `$gte`, `$lt`, each in its own condition under `$and` (not in the method schema's list, but it works) |

The method schema also lists `$exists`, but it is rejected with `400 filter parser Unknown operator $exists`. A field that is not listed here is rejected with `400 filter parser Unknown token`.

Free text (`search.fields`) accepts `loginEmail`, `contact.firstName`, `contact.lastName`, `profile.nickname`, `profile.slug` and `profile.title`, at most 4 of them.

**One member by email or name, with the fallback, as one flow:**

1. Send the filter:

   ```bash
   curl -X POST 'https://www.wixapis.com/members/v1/members/query' \
   -H 'Content-Type: application/json' \
   -H 'Authorization: <AUTH>' \
   -d '{
     "query": { "filter": { "loginEmail": "jordan.reyes@example.com" } },
     "fieldsets": ["FULL"]
   }'
   ```

   For a name, send `{"query": {"filter": {"contact.firstName": "Sam", "contact.lastName": "Ortiz"}}, "fieldsets": ["FULL"]}` instead.

   A match comes back as:

   ```json
   {
     "members": [{
       "id": "<member id>",
       "loginEmail": "jordan.reyes@example.com",
       "status": "APPROVED",
       "contactId": "<contact id>",
       "contact": { "firstName": "Jordan", "lastName": "Reyes" },
       "profile": { "nickname": "Jordan Reyes", "slug": "jordan-reyes12345" },
       "createdDate": "2026-11-02T11:39:50Z"
     }],
     "metadata": { "count": 1, "offset": 0, "total": 1 }
   }
   ```

2. When `members` is empty, send the every-member query (below) and keep the member whose `loginEmail`, `contact.firstName` and `contact.lastName`, or `profile.nickname` equals the user's words, ignoring case. Do both steps before you answer.
3. Use the member's `id` for the calls in Step 4.

How these fields behave:

- **In a filter, write each field as one dotted key**, exactly as in the table: `{"profile.nickname": "Syam K"}`. A nested object such as `{"profile": {"nickname": "Syam K"}}` is rejected with `400 filter parser Unknown token profile`.
- **Email and names** in a filter match the whole value and ignore case. `$startsWith` also works on them.
- **Free text** searches only `profile.nickname` unless you send `fields`, so always send `fields`. It ignores case and matches the start of a word from 3 letters ("Noe" finds Noel, "No" does not). Any one word is enough: "Syam Nobody" returns Syam Testkumar. So keep only the members whose first name, last name or nickname starts with each word the user gave, ignoring case. For a word shorter than 3 letters, read every member (below) and match in code. Do not search for an email as free text: `"jane@example.com"` also returns every other member at `example.com`. Filter on `loginEmail` instead.
- **New and changed members can be missing from filters and search.** Members created or renamed in the last minutes, and in tests up to about 30 minutes, were not found by `loginEmail`, name or `profile.nickname`, while a query without a filter returned them at once. So when a filter or a search finds nothing, read every member (below) and match the email or name in code, ignoring case, before you tell the user there is no such member.
- **Sort.** Query Members accepts `"sorting": [{"fieldName": "createdDate", "order": "DESC"}]` inside `query` (the key is `sorting`, not `sort`). List Members rejects a `createdDate` sort with `400 INVALID_SORT_FIELD`.

**Every member.** Send the query with no filter and page with `offset`:

```bash
curl -X POST 'https://www.wixapis.com/members/v1/members/query' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "query": { "paging": { "limit": 100, "offset": 0 } },
  "fieldsets": ["FULL"]
}'
```

`paging.limit` is at most 100. `metadata.total` is the number of members that match; to only count them, send `"paging": {"limit": 1}` and read `metadata.total`. Increase `offset` by `limit` until you have read `metadata.total` members. `GET https://www.wixapis.com/members/v1/members?fieldsets=FULL&paging.limit=100&paging.offset=0` (List Members) returns the same list.

## Step 3: Read the fields

The response holds `members[]` and `metadata` (`count`, `offset`, `total`). Each member has:

| Field | What it holds |
|---|---|
| `id` | Member ID. Other APIs that work on members take it, for example a blog post's `memberId`; for a post author, follow Part 0 of [How to Create Blog Posts](../blog/how-to-create-blog-posts.md) instead |
| `contactId` | The member's contact, for [Update a Contact](update-a-contact.md). Do not assume it equals `id` |
| `loginEmail` | The email the member logs in with (FULL or EXTENDED only) |
| `status` | `PENDING` (waiting for approval), `APPROVED` (approved: can log in once the member has a password), `BLOCKED` (cannot log in), `OFFLINE` (a blog guest writer who cannot log in). `UNKNOWN` means the fieldset was `PUBLIC` |
| `contact.firstName`, `contact.lastName` | Name |
| `profile.nickname` | The name the site shows for the member, such as the author name on blog posts |
| `profile.slug` | The member's profile page path |
| `createdDate` | When the member joined |
| `lastLoginDate` | Last login, when there is one |
| `privacyStatus` | `PRIVATE` or `PUBLIC` profile |

Read one member by ID with `GET https://www.wixapis.com/members/v1/members/<memberId>?fieldsets=FULL`; it returns `{"member": {...}}`.

## Step 4: Change a member

These four calls are complete as shown; send them without a schema lookup. Each returns the changed member in `member`. Read `member.status` or `member.profile.nickname` from the response to confirm; no second read is needed.

A request that names the member and the action ("approve Jane Doe", "block jane@example.com") is the user's confirmation: find the member (Step 2), then make the call. Ask first when the user did not name the action, or when more than one member matches.

**Approve a pending member, or unblock a blocked one:**

```bash
curl -X POST 'https://www.wixapis.com/members/v1/members/<memberId>/approve' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{}'
```

**Block a member** (they can no longer log in):

```bash
curl -X POST 'https://www.wixapis.com/members/v1/members/<memberId>/block' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{}'
```

To unblock, use Approve: on a `BLOCKED` member it returns the member with `status: "APPROVED"` (tested on a live site). Both calls succeed when the member already has the target status, so you can repeat them safely.

**Change the name the site shows** (for example a blog author name):

```bash
curl -X PATCH 'https://www.wixapis.com/members/v1/members/<memberId>' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{ "member": { "profile": { "nickname": "Jane D." } } }'
```

The member ID goes in the URL; the body needs no `id`, `revision` or field mask. Only the fields you send change; `contact.firstName`, `contact.lastName` and `loginEmail` stay as they were. The response is the whole updated member, with `loginEmail` and `status`.

**Add a member:**

```bash
curl -X POST 'https://www.wixapis.com/members/v1/members' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "member": {
    "loginEmail": "jane@example.com",
    "contact": { "firstName": "Jane", "lastName": "Doe" }
  }
}'
```

The new member has `status: "APPROVED"`, and `profile.nickname` is the contact name unless you send `member.profile.nickname`. It cannot log in until it sets a password; [Send Set Password Email](https://dev.wix.com/docs/api-reference/crm/members-contacts/members/member-authentication/send-set-password-email) emails it a link, so send that only when the user asks. When adding several members, wait about one second between calls to stay under the rate limit.

## Related

- [Query Members](https://dev.wix.com/docs/api-reference/crm/members-contacts/members/member-management/members/query-members)
- [List Members](https://dev.wix.com/docs/api-reference/crm/members-contacts/members/member-management/members/list-members)
- [Approve Member](https://dev.wix.com/docs/api-reference/crm/members-contacts/members/member-management/members/approve-member) and [Bulk Approve Members](https://dev.wix.com/docs/api-reference/crm/members-contacts/members/member-management/members/bulk-approve-members)
- [Block Member](https://dev.wix.com/docs/api-reference/crm/members-contacts/members/member-management/members/block-member)
- [Update Member](https://dev.wix.com/docs/api-reference/crm/members-contacts/members/member-management/members/update-member)
- [Create Member](https://dev.wix.com/docs/api-reference/crm/members-contacts/members/member-management/members/create-member)
