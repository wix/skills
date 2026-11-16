---
name: "Create a Group"
description: Creates a Wix Groups group on a site step by step, suggesting a name and a description, letting the user choose the privacy (public, private or hidden), and setting a site member as the group's creator and admin. Use when the user wants to create a group, start a community group, or set up a new group on their site.
---
# Create a Group

## Role
You help the site owner create a group in Wix Groups. Ask only one question per message. Work with names only: never show ids to the user.

Every call below is a site call: make it with site scope and the site ID in the tool's site ID parameter. Use only the [Create a group](#create-a-group-script) script in this recipe to check the app, find the creator and create the group. Run it as written and as its own call, fill in only its inputs, and **follow the `note` it returns**: it says what to tell or ask the user next, and when to end your turn. When it returns a `question`, end your reply with that question, word for word. The script has every endpoint, body and response path it needs: do not search the docs or read the method schemas before running it.

| Call (made by the script) | Purpose |
|---|---|
| `GET https://www.wixapis.com/apps-installer-service/v1/app-instances` | check that Wix Groups is installed |
| `GET https://www.wixapis.com/roles-management/v2/contributors/query` | read the site owner's user id (`accountOwnerId`) |
| `GET https://www.wixapis.com/members/v1/members/{id}` | read the site owner's member record, and the creator Wix set |
| `POST https://www.wixapis.com/members/v1/members/query` | find the member the user named, or list up to 10 members to choose from |
| `POST https://www.wixapis.com/social-groups-proxy/groups/v2/groups` | create the group |

Docs: [Create Group](https://dev.wix.com/docs/api-reference/crm/community/groups/groups/create-group), [Find and Manage Site Members](../contacts/find-and-manage-site-members.md), [Manage Site Collaborators](../collaborators/manage-site-collaborators.md), [List Installed Apps](../app-installation/list-installed-apps.md), [Install Wix Apps](../app-installation/install-wix-apps.md).

## Steps
To create a group, next flow should be followed excatly:
1. check if Wix Groups app is installed, if not, ask the user if they wish to install it.
2. Select a Group Name: The Agent should suggest a name based on the knowledge about user.
3. Select a Group Description: The Agent should suggest a description based on the knowledge about user and the group name.
4. Select a Group Privacy: Select whether the group will be public, private, or secret (hidden).
5. Choose the group's creator (see Choose the creator).
6. Create a Group.

After the group is created, user can start inviting members and customizing the group settings.

When the user's request already gives a name, a description or a privacy option, accept it and skip that step's suggestions.

Run the [Create a group](#create-a-group-script) script at the start, with whatever the user's request already gives and the rest left empty, and again each time the user answers. It goes through the steps in this order and stops at the first one that still needs the user: its `note` names that step.

### Check that Wix Groups is installed

The script checks it. Wix Groups is installed when an entry in `appInstances[]` has `appDefId` `148c2287-c669-d849-d153-463c7486a694`. If it is not, tell the user that Wix Groups is not installed on the site and ask if they wish to install it; end your turn on that question. Install it only after the user says yes ([Install Wix Apps](../app-installation/install-wix-apps.md)), then run the script again. Consent to create a group is not consent to install an app: a request that says to go ahead without asking does not cover installing Wix Groups, so ask even then.

### Select a group name

**Goal**: Suggest personalized group names and let user select one.

1. **Suggest 4 unique, non-offensive names:** Ensure at least one name includes an emoji.
2. **Show them as a numbered list** in your message.
3. **Ask for user feedback:** With displaying the names, ask: "Do you like any of the suggested names for your group? Please choose one from the list below or share your own idea if you have something specific in mind."
4. **Accept the chosen or provided name:** Only when the user provides or selects a group name, accept it and move on without suggesting names again.

**No future tense or greetings:** Present actions as if they are already happening.

### Select a group description

Goal: Suggest personalized group descriptions and let user select one.

1. Once the group name is chosen, suggest 2-3 unique descriptions.
2. Each description must be 3 to 5 sentences, 250 to 500 characters total.
3. Show them as a numbered list in your message.
4. With the list, say:
   "Do you like any of the suggested description for your group? Please choose one from the list below or share your own idea if you have something specific in mind."
5. If the user provides feedback or wants different descriptions, repeat the process.

### Select a group privacy

Goal: Suggest available privacy options to the user and let the user select one.

1. When it's time to choose privacy, prompt the user with the exact message "Please choose a privacy option for your group" and show these options as a numbered list:
   1. **Public**: Anyone can see the group and its posts, and anyone can join.
   2. **Private**: Anyone can find the group, but only members can see its posts. People ask to join.
   3. **Hidden**: Only members can see the group. People join only when they are added or invited.
2. The script sends the choice as `privacyStatus`: Public is `PUBLIC`, Private is `PRIVATE`, Hidden (secret) is `SECRET`.

### Choose the creator

Every group has a creator: a site member who becomes the group's owner and admin. The script always sends that member's id as `creatorId` in the create call. When the call is made with an API key, Wix rejects a create without it (`400`, "Group's createdBy.id can't be empty").

- **The user names a member** (by name or email): the script queries the site members with a filter on `loginEmail`, `profile.nickname`, or `contact.firstName` and `contact.lastName`, as in [Find and Manage Site Members](../contacts/find-and-manage-site-members.md) (Step 2), and keeps the members whose email, nickname or full name equals what the user said, ignoring case. The filter ignores case too. A member created or renamed in the last minutes can be missing from filters, so when the filter finds no one the script also checks the 100 newest members in code. If several members match, ask the user to pick; if none match, say so and ask who should create the group.
- **The user names no one**: the creator is the site owner's own member record. Query Site Contributors returns the owner's user id as `accountOwnerId` ([Manage Site Collaborators](../collaborators/manage-site-collaborators.md), step 2):

  ```json
  { "contributors": [ { "accountId": "<account GUID>", "accountOwnerId": "<owner user GUID>" } ] }
  ```

  When the owner has a member record on the site, that member's `id` is the owner's user id, so the script reads it with `GET https://www.wixapis.com/members/v1/members/<accountOwnerId>?fieldsets=FULL`; a `404` means the owner has no member record. If it finds that member, it uses it, and the confirmation names that member as the creator. If not, ask the user which site member should create the group, showing up to 10 member names as a numbered list. Consent to create a group is not consent to choose its creator: a request that says to go ahead without asking does not cover picking a member, so ask even then.

Never create a site member to use as the creator.

### Confirming the creation
Ask the user to confirm before creating the group, even when the request is clear. Say exactly what will be created (name, privacy and creator) and end your turn: your final message must end with the question ("Create the public group Trail Runners, with Dana Levi as its creator?"), and the code you run this turn must not contain the create call. Make the call only in a later turn, after the user says yes. Treat the request as already confirmed only when it carries explicit consent on top of the instruction, such as "yes", "go ahead" or "no need to confirm", and names the group; then make the call without asking. That consent covers only the create call: it does not cover installing Wix Groups or choosing the creator.

The script does this for you: run it with `userConfirmed = false` and it creates nothing and returns the `question` to end your reply with. Run it with `userConfirmed = true` only after the user says yes, or when the request already carries explicit consent as above.

### Create the group

**Goal:**
Create the group using the chosen name, description, and privacy option.

1. Once the group name, description, privacy option and creator are selected, the script creates the group with these details:

   ```
   POST https://www.wixapis.com/social-groups-proxy/groups/v2/groups

   {
     "group": {
       "name": "Trail Runners",
       "description": "A group for trail runners in the area. ...",
       "privacyStatus": "PUBLIC"
     },
     "creatorId": "<member id>"
   }
   ```

2. Do not mention the call or any implementation details to the user.
3. The script reads the result from the response, not from what it sent, and its note says what to report:
   - `group` with an `id`: the group exists. Its creator is the member in `group.ownerId`; name that member. When the call runs as a signed-in Wix user, Wix makes that user the creator, so `ownerId` can differ from `creatorId`: report the member Wix set. If that member is not the one the user asked for, say so: Wix made the signed-in user the group's creator.
   - A response without `group.id`: tell the user the group was not created and explain what the response says. The site's **Group Creation** setting (Groups > General Settings in the dashboard) can require a site admin's approval for groups that members create.
   - `403` (`PERMISSION_DENIED`): explain that they cannot create a group on this site, and stop.
   - Any other error: explain it plainly.
4. After the group is successfully created, inform the user that their group has been created without mentioning the internal steps or tools used. For example:
   "Your group has been created successfully! You can now start inviting members and customizing the group settings."

## Create a group script

Fill in only the inputs: what the user's request or answers gave, and an empty string for the rest. Set `creator` only when the user named the member who should create the group; leave it empty otherwise. After the user picks a member from a list the script returned, set `creator` to the name or email the user chose.

```javascript
async function () {
  const name = "<group name the user gave or chose, or empty>";
  const description = "<group description the user gave or chose, or empty>";
  const privacy = "<Public, Private or Hidden as the user chose it, or empty>";
  const creator = "<the member's name or email as the user said it or chose it from this script's list, or empty>";
  const userConfirmed = false; // true only after the user said yes to this group, or the request already said "go ahead" / "no need to confirm"

  const GROUPS_APP = "148c2287-c669-d849-d153-463c7486a694";
  const payload = function (res) { return (res && res.data) || res || {}; };
  const memberName = function (m) {
    const c = m.contact || {};
    const full = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
    return full || (m.profile && m.profile.nickname) || m.loginEmail || "";
  };
  const errorOf = function (e) {
    const text = String((e && e.message) || e);
    const code = text.match(/\((\d{3})\)/);
    return { status: code ? Number(code[1]) : null, details: text };
  };

  const apps = payload(await wix.request({ method: "GET", url: "https://www.wixapis.com/apps-installer-service/v1/app-instances" }));
  if (!(apps.appInstances || []).some(function (a) { return a.appDefId === GROUPS_APP; })) {
    return {
      step: "install",
      created: false,
      question: "Wix Groups is not installed on your site. Would you like to install it?",
      note: "Wix Groups is not installed, and only the user can agree to install it. Consent to create a group is not consent to install an app: a request that says to go ahead or not to ask does not cover this, so ask even then. Tell the user and end your reply with the question above; end your turn. Do not install Wix Groups or any other app, and do not create a group, until the user says yes in a later turn. After a yes, install it with Install Wix Apps and run this script again."
    };
  }
  if (!name.trim()) {
    return {
      step: "name",
      created: false,
      question: "Do you like any of the suggested names for your group? Please choose one from the list below or share your own idea if you have something specific in mind.",
      note: "No group name yet. Suggest 4 unique, non-offensive group names that fit what the user told you, at least one with an emoji, as a numbered list, then end your reply with the question above and end your turn. Do not pick a name yourself, do not ask about the description or privacy in this message, and do not create the group."
    };
  }
  if (!description.trim()) {
    return {
      step: "description",
      created: false,
      question: "Do you like any of the suggested description for your group? Please choose one from the list below or share your own idea if you have something specific in mind.",
      note: "No description yet. Suggest 2-3 unique descriptions for the group " + name.trim() + ", each 3 to 5 sentences and 250 to 500 characters, as a numbered list, then end your reply with the question above and end your turn. Do not create the group."
    };
  }
  const privacyStatus = { public: "PUBLIC", private: "PRIVATE", hidden: "SECRET", secret: "SECRET" }[privacy.trim().toLowerCase()];
  if (!privacyStatus) {
    return {
      step: "privacy",
      created: false,
      question: "Please choose a privacy option for your group",
      options: [
        "Public: Anyone can see the group and its posts, and anyone can join.",
        "Private: Anyone can find the group, but only members can see its posts. People ask to join.",
        "Hidden: Only members can see the group. People join only when they are added or invited."
      ],
      note: "No privacy option yet. Send the question above with the options as a numbered list, and end your turn. Do not create the group."
    };
  }

  const MEMBERS = "https://www.wixapis.com/members/v1/members";
  const queryMembers = async function (query) {
    return payload(await wix.request({ method: "POST", url: MEMBERS + "/query", body: { query: query, fieldsets: ["FULL"] } })).members || [];
  };
  const getMember = async function (id) {
    if (!id) return null;
    try {
      return payload(await wix.request({ method: "GET", url: MEMBERS + "/" + id + "?fieldsets=FULL" })).member || null;
    } catch (e) {
      if (errorOf(e).status === 404) return null;
      throw e;
    }
  };
  const listNames = async function () {
    return (await queryMembers({ paging: { limit: 10 } })).map(memberName);
  };

  let member = null;
  if (creator.trim()) {
    const wanted = creator.trim().toLowerCase();
    const isMatch = function (m) {
      const c = m.contact || {};
      return (m.loginEmail || "").toLowerCase() === wanted
        || ((m.profile && m.profile.nickname) || "").toLowerCase() === wanted
        || [c.firstName, c.lastName].filter(Boolean).join(" ").toLowerCase() === wanted;
    };
    const words = creator.trim().split(/\s+/);
    const anyOf = [{ loginEmail: creator.trim() }, { "profile.nickname": creator.trim() }];
    if (words.length > 1) anyOf.push({ "contact.firstName": words[0], "contact.lastName": words.slice(1).join(" ") });
    let matches = (await queryMembers({ filter: { "$or": anyOf }, paging: { limit: 10 } })).filter(isMatch);
    if (matches.length === 0) {
      matches = (await queryMembers({ sorting: [{ fieldName: "createdDate", order: "DESC" }], paging: { limit: 100 } })).filter(isMatch);
    }
    if (matches.length === 0) {
      return {
        step: "creator",
        created: false,
        members: await listNames(),
        question: "I couldn't find a site member named " + creator.trim() + ". Which site member should create the group?",
        note: "No site member matches. Show the member names above as a numbered list, end your reply with the question above and end your turn. Do not pick a member yourself, never create a site member, and do not create the group. Run this script again with creator set to the name the user chooses."
      };
    }
    if (matches.length > 1) {
      return {
        step: "creator",
        created: false,
        members: matches.slice(0, 10).map(function (m) { return { name: memberName(m), email: m.loginEmail || null }; }),
        question: "Several site members match " + creator.trim() + ". Which one should create the group?",
        note: "Several members match. Show their names and emails as a numbered list, end your reply with the question above and end your turn. Do not pick a member yourself. Run this script again with creator set to the email the user chooses."
      };
    }
    member = matches[0];
  } else {
    const contributors = payload(await wix.request({ method: "GET", url: "https://www.wixapis.com/roles-management/v2/contributors/query" })).contributors || [];
    member = await getMember((contributors[0] || {}).accountOwnerId);
    if (!member) {
      const names = await listNames();
      return {
        step: "creator",
        created: false,
        members: names,
        question: names.length
          ? "Which site member should create the group and be its admin?"
          : "A group needs a site member as its creator, and your site has no members yet. Who should create the group?",
        note: "The site owner has no member record on this site, so there is no default creator, and only the user can choose one. Consent to create a group is not consent to choose its creator: a request that says to go ahead or not to ask does not cover this, so ask even then. Show the member names above as a numbered list, end your reply with the question above and end your turn. Do not pick a member yourself, do not run this script again this turn, never create a site member, and do not create the group. After the user answers, run this script again with creator set to the name they chose."
      };
    }
  }

  const label = { PUBLIC: "public", PRIVATE: "private", SECRET: "hidden" }[privacyStatus];
  if (!userConfirmed) {
    return {
      step: "confirm",
      created: false,
      creator: memberName(member),
      question: "Create the " + label + " group " + name.trim() + ", with " + memberName(member) + " as its creator?",
      note: "Nothing was created. Tell the user what will be created (name, privacy and creator), end your reply with the question above and end your turn. The create call must not run this turn. Run this script again with userConfirmed = true only after the user says yes."
    };
  }

  const body = {
    group: { name: name.trim(), description: description.trim(), privacyStatus: privacyStatus },
    creatorId: member.id
  };
  let res;
  try {
    res = payload(await wix.request({ method: "POST", url: "https://www.wixapis.com/social-groups-proxy/groups/v2/groups", body: body }));
  } catch (e) {
    const err = errorOf(e);
    return {
      step: "create",
      created: false,
      error: err,
      note: err.status === 403
        ? "Wix refused the create (PERMISSION_DENIED). Tell the user they cannot create a group on this site, and stop."
        : "The group was not created. Tell the user so and explain the error plainly. Do not say the group was created."
    };
  }
  const group = res.group || {};
  if (!group.id) {
    return {
      step: "create",
      created: false,
      response: res,
      note: "The response has no group, so the group was not created. Tell the user it was not created and explain what the response says. The site's Group Creation setting (Groups > General Settings in the dashboard) can require a site admin's approval for groups that members create."
    };
  }
  const owner = group.ownerId === member.id ? member : await getMember(group.ownerId).catch(function () { return null; });
  const ownerName = owner ? memberName(owner) : null;
  return {
    step: "done",
    created: true,
    group: { name: group.name, privacyStatus: group.privacyStatus, creator: ownerName },
    note: group.ownerId === member.id
      ? "The group was created. Tell the user it was created and name " + memberName(member) + " as its creator, without mentioning ids, calls or tools."
      : "The group was created, but Wix made the signed-in user its creator" + (ownerName ? " (" + ownerName + ")" : "") + " instead of " + memberName(member) + ". Tell the user it was created and say so, without mentioning ids, calls or tools."
  };
}
```
