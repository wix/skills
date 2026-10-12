---
name: "Manage Site Collaborators"
description: Manages who has access to a Wix site as a collaborator (contributor) — finds the site's current collaborators, invites someone, removes a collaborator, and resends or revokes a pending collaborator invite. Use when the user wants to give someone access to the site, take it away, or follow up on an invitation that has not been accepted.
---
# Manage Site Collaborators

## Description
Changes who can work on a site: invite a collaborator, remove one, or resend / revoke an invitation that has not been accepted yet.

## API Endpoints
- `GET https://www.wixapis.com/roles-management/roles` — look up role IDs for invites
- `GET https://www.wixapis.com/roles-management/v2/contributors/query` — list the site's collaborators
- `POST https://www.wixapis.com/invites/site-invite/bulk` — send invites (returns the `inviteId`s)
- `POST https://www.wixapis.com/roles-management/contributor/remove` — remove a collaborator
- `POST https://www.wixapis.com/invites/site-invite/{inviteId}/resend` — resend a pending invite
- `POST https://www.wixapis.com/invites/site-invite/{inviteId}/revoke` — revoke a pending invite

Docs: [Contributors](https://dev.wix.com/docs/api-reference/account-level/user-management/sites/contributors/introduction), [Site Invites](https://dev.wix.com/docs/api-reference/account-level/user-management/sites/site-invites/introduction)

## What the APIs can and cannot look up

- **Never call Remove Contributor, revoke or resend until you have the exact ID from the user or from an earlier response.** Look-ups by email or name are not possible, so ask first. If the user names someone only by email or name, read this recipe, then reply asking for the account ID (and how to find it) — at most one Query Site Contributors call, and do not search other APIs for an email-to-account lookup or try bulk or guessed deletes.
- **Collaborators are identified by account ID, not email.** Query Site Contributors returns only `accountId` and `accountOwnerId` per collaborator. If the user names a collaborator by email or name, ask them for that person's account ID, or for how to find it, before removing anyone. Do not guess which account ID belongs to which person.
- **Invites are identified by `inviteId`.** There is no endpoint to list a site's pending invites. The `inviteId` is returned when the invite is created (`invites[].id` in the Bulk Invite response, Step 6) — keep it if you will need to resend or revoke later in the conversation. If the user does not have it, say that it cannot be looked up through the API and ask them to provide it.
- **Bulk Invite, resend and revoke need an account-level API key.** They cannot be called with the standard `Authorization` header of a site-level token; If a call is rejected for authorization, the most likely cause is that these endpoints require an account-level API key rather than a site-level token — tell the user this.

## Steps

### 1. Establish which action the user wants and on whom

| User wants | Needs | Go to |
|---|---|---|
| Remove someone who already has access | their `accountId` | Step 2, then Step 3 |
| Invite someone new | their email(s) and a role (`policyIds`) | Step 6 |
| Cancel an invite not yet accepted | the `inviteId` | Step 4 |
| Resend an invite not yet accepted | the `inviteId` | Step 5 |

Removal works only on existing collaborators; revoke and resend work only on pending invites. Do not use one for the other.

### 2. List the site's collaborators

```
GET https://www.wixapis.com/roles-management/v2/contributors/query
```

No filter is needed to list everyone. To narrow by role, pass `filter.policyIds` (up to 20 role IDs) as repeated query parameters. Response:

```json
{ "contributors": [ { "accountId": "<account GUID>", "accountOwnerId": "<owner user GUID>" } ] }
```

Always run this read-only query first, even when the user says to check with them before changing anything: the confirmation question comes after the lookup, never instead of it. Use it to confirm the `accountId` the user gave is a current collaborator before removing it. If it is not in the list, stop and tell the user they have no collaborator access to remove.

### 3. Remove a collaborator

Removal clears all of the collaborator's role assignments on the site, so they lose access. **Ask the user to confirm the exact account first**, then call:

```
POST https://www.wixapis.com/roles-management/contributor/remove
```
```json
{ "accountId": "<accountId from step 2>" }
```

The response is `{}` on success.

### 4. Revoke a pending invite

**Ask the user to confirm** which invite to cancel, then call, with no body:

```
POST https://www.wixapis.com/invites/site-invite/{inviteId}/revoke
```

The response is `{}`. Revoke applies to pending invites only; if the person has since accepted and appears in the Step 2 list, use Step 3 instead.

### 5. Resend a pending invite

**Ask the user to confirm**, then call, with no body:

```
POST https://www.wixapis.com/invites/site-invite/{inviteId}/resend
```

The response contains the invite: `invite.id`, `invite.email`, `invite.status` (Pending, Used, Deleted, Declined, Expired) and `invite.expirationDate`. Report the status back to the user.

### 6. Send an invite

Ask the user for the email address(es) (1–10) and which role to grant; `policyIds` are role IDs, not names. Look them up with `GET https://www.wixapis.com/roles-management/roles` ([Get Roles Info](https://dev.wix.com/docs/api-reference/account-level/user-management/accounts/users/get-roles-info)), which returns `predefinedRoles` and `customRoles`; use the ID of the role the user chose, and do not guess an ID. If the user has not named a role, ask which one. **Ask the user to confirm** the emails and role, since this sends real emails, then call:

```
POST https://www.wixapis.com/invites/site-invite/bulk
```
```json
{ "policyIds": ["<role id>"], "emails": ["person@example.com"] }
```

The response has `invites[]` (each with `id`, `email`, `status`, `expirationDate`) and `failedEmails` / `failedInvites`. Report any that failed. Keep each `invites[].id`: it is the `inviteId` for Steps 4 and 5.

## Reporting back

State what was done, to which account or email, and the outcome. Do not show raw IDs unless the user asks.
