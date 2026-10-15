---
name: "Manage Site Collaborators"
description: Manages who has access to a Wix site as a collaborator (contributor) — finds the site's current collaborators, invites someone, removes a collaborator, and resends or revokes a pending collaborator invite. Use when the user wants to give someone access to the site, take it away, or follow up on an invitation that has not been accepted.
---
# Manage Site Collaborators

## Description
Changes who can work on a site: invite a collaborator, remove one, or resend / revoke an invitation that has not been accepted yet.

## API Endpoints
Each call runs at one of two scopes. Use the scope shown. A site call is made with site scope and the site ID in the tool's site ID parameter; that is the only way the site reaches Wix, so never add a site ID to the request body. An account call is made with account scope, which ignores the site ID.

| Scope | Call | Purpose |
|---|---|---|
| Site | `GET https://www.wixapis.com/roles-management/v2/contributors/query` | list the site's collaborators |
| Site | `POST https://www.wixapis.com/roles-management/contributor/remove` | remove a collaborator |
| Account | `GET https://www.wixapis.com/roles-management/roles` | look up role IDs for invites |
| Site | `POST https://www.wixapis.com/invites/site-invite/bulk` | send invites (returns the `inviteId`s) |
| Site | `POST https://www.wixapis.com/invites/site-invite/{inviteId}/resend` | resend a pending invite |
| Site | `POST https://www.wixapis.com/invites/site-invite/{inviteId}/revoke` | revoke a pending invite |

Docs: [Contributors](https://dev.wix.com/docs/api-reference/account-level/user-management/sites/contributors/introduction), [Site Invites](https://dev.wix.com/docs/api-reference/account-level/user-management/sites/site-invites/introduction)

## What the APIs can and cannot look up

- **This recipe has everything you need for every call below: endpoint, request and response shape. Do not search the docs, read the method articles or query the API spec before calling.** Go straight to the call. If the user names someone only by email or name, your final message must ask for their account ID (or invite ID for an invite) — say this even when the lookup shows only the owner.
- **Never call Remove Contributor, revoke or resend until you have the exact ID from the user or from an earlier response.** Look-ups by email or name are not possible, so ask first. If the user names someone only by email or name, read this recipe, then reply asking for the account ID (and how to find it) — at most one Query Site Contributors call, and do not search other APIs for an email-to-account lookup or try bulk or guessed deletes. Your final message must say that collaborators can only be identified by account ID, and ask the user to provide it — even if the query failed or returned nothing useful.
- **Collaborators are identified by account ID, not email.** Query Site Contributors returns only `accountId` and `accountOwnerId` per collaborator. If the user names a collaborator by email or name, ask them for that person's account ID, or for how to find it, before removing anyone. Do not guess which account ID belongs to which person.
- **Invites are identified by `inviteId`.** There is no endpoint to list a site's pending invites. The `inviteId` is returned when the invite is created (`invites[].id` in the Bulk Invite response, Step 6) — keep it if you will need to resend or revoke later in the conversation. If the user does not have it, say that it cannot be looked up through the API and ask them to provide it.
- **Get Roles is the only account-level call** (account scope). Query Site Contributors, Remove Contributor, Bulk Invite, resend and revoke are site-level: make them with site scope and the site ID. Never make Bulk Invite, resend or revoke with account scope: the site is dropped and Wix rejects the call with a missing-site error. If a call is still rejected (403), the cause is not always visible in the response; stop, tell the user the call was refused, and do not call the later steps of the flow.

## Steps

### 1. Establish which action the user wants and on whom

| User wants | Needs | Go to |
|---|---|---|
| Remove someone who already has access | their `accountId` | Step 2, then Step 3 |
| Remove themselves | their own `accountId` | Step 7 |
| Invite someone new | their email(s) and a role (`policyIds`) | Step 6 |
| Cancel an invite not yet accepted | the `inviteId` | Step 4 |
| Resend an invite not yet accepted | the `inviteId` | Step 5 |

Removal works only on existing collaborators; revoke and resend work only on pending invites. Do not use one for the other.

**When the user names the person only by email**, work out what that email is before acting:

1. **Invited earlier in this conversation?** If the email matches an `invites[].email` from a Bulk Invite response you received, you have its `inviteId`: treat the person as an invitee (Step 4 or 5). If the user asked to *remove* them, cancel the invite (Step 4).
2. **Otherwise the email cannot be classified.** The APIs cannot say whether it belongs to a collaborator, a pending invitee, or nobody, so do not claim "not a collaborator" or "has no access". Say that collaborators are identified by account ID and invites by invite ID, and ask for the one that fits the request (for removal, the account ID). Do not guess from the contributors list.
3. **Wrong-mode guards.** Do not revoke or resend for someone the user says already has access, and do not remove someone the user says is only invited. In those cases tell the user which action applies instead (for example: "they have only been invited, so I can cancel the invite rather than remove them").

### 2. List the site's collaborators

```
GET https://www.wixapis.com/roles-management/v2/contributors/query
```

No filter is needed to list everyone. To narrow by role, pass `filter.policyIds` (up to 20 role IDs) as repeated query parameters. Response:

```json
{ "contributors": [ { "accountId": "<account GUID>", "accountOwnerId": "<owner user GUID>" } ] }
```

Always run this read-only query before removing anyone. Use it to confirm the `accountId` the user gave is a current collaborator. If it is not in the list, stop and tell the user that account is not a collaborator on the site, so there is nothing to remove. If it is the site owner's account (it matches `accountOwnerId`), do not remove it: an owner can leave only after transferring ownership to another user. Tell the user that.

### 3. Remove a collaborator

Removal clears all of the collaborator's role assignments on the site, so they lose access. When the user gave the exact `accountId` and Step 2 shows it is a current collaborator (and not the owner), call it directly — do not ask for confirmation:

```
POST https://www.wixapis.com/roles-management/contributor/remove
```
```json
{ "accountId": "<accountId from step 2>" }
```

The response is `{}` on success.

### 4. Revoke a pending invite

When the user named the invite (or you created it earlier in this conversation and hold its `inviteId`), call it directly with an empty JSON body `{}`. Ask only if you cannot tell which invite is meant:

```
POST https://www.wixapis.com/invites/site-invite/{inviteId}/revoke
```

The response is `{}`. Revoke applies to pending invites only; if the person has since accepted and appears in the Step 2 list, use Step 3 instead.

### 5. Resend a pending invite

When the user named the invite (or you created it earlier in this conversation and hold its `inviteId`), call it directly with an empty JSON body `{}`. Ask only if you cannot tell which invite is meant:

```
POST https://www.wixapis.com/invites/site-invite/{inviteId}/resend
```

The response contains the invite: `invite.id`, `invite.email`, `invite.status` (Pending, Used, Deleted, Declined, Expired) and `invite.expirationDate`. Report the status back to the user.

### 6. Send an invite

Ask the user for the email address(es) (1–10) and which role to grant; `policyIds` are role IDs, not names. Look them up with `GET https://www.wixapis.com/roles-management/roles` ([Get Roles Info](https://dev.wix.com/docs/api-reference/account-level/user-management/accounts/users/get-roles-info)), which returns `predefinedRoles` and `customRoles`. Add `?filter.role_level=SITE_LEVEL` to list only site roles. Each entry is `{ "id": "<role id>", "title": "...", "description": "..." }`; use the ID of the role the user chose, and do not guess an ID. If the user said "any" or "a standard role", pick from `predefinedRoles` the role whose `description` grants the least access (view or content editing, not managing, billing or ownership) and name its `title` in your final message; if they gave no role at all, ask which one. Once you have the emails and a role, send the invite without asking for confirmation:

```
POST https://www.wixapis.com/invites/site-invite/bulk
```
```json
{ "policyIds": ["<role id>"], "emails": ["person@example.com"] }
```

The response has `invites[]` (each with `id`, `email`, `status`, `expirationDate`) and `failedEmails` / `failedInvites`. Report any that failed. Keep each `invites[].id`: it is the `inviteId` for Steps 4 and 5.

### 7. Remove the current user from the site ("remove me")

The APIs cannot tell who is talking to you, so you need the user's own `accountId` from them. Then:

1. Run Step 2. If their account is not in the contributors list, stop: the site owner is not listed as a collaborator, and an owner can leave only after transferring ownership to another user. Tell them that and do not call Remove Contributor.
2. Call Remove Contributor (Step 3) with their `accountId`. The user asked for this, so do not ask for confirmation, but do not soften it afterwards: removal cannot be undone.
3. On success, state clearly and in bold that they can no longer use this site's dashboard, and should close the tab or click the Wix logo at the top left to go to All Sites. For example: **You have been removed from this site. The dashboard will no longer work for you — close this tab or click the Wix logo at the top left to go to All Sites.**

## Reporting back

State what was done, to which account or email, and the outcome. Do not show raw IDs unless the user asks. Always say which of these happened:

- **Succeeded**, e.g. "The invite for james@bond.com has been canceled."
- **Failed**, e.g. "I couldn't resend the invite for james@bond.com. Please try again." If the call returns 403, say so; do not guess a cause.
- **Not done**, with the reason, e.g. "That account is not a collaborator on this site, so there was nothing to remove." or "That is the site owner's account, which cannot be removed without transferring ownership."

For resend, read `invite.status` in the response: if it is `Used`, the person already accepted and is now a collaborator, so say they already have access rather than that the invite was resent; `Declined`, `Expired` or `Deleted` mean the invite is no longer pending.
