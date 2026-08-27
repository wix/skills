# Dashboard UX Success Model

What makes a generated dashboard page actually *succeed* for the person using it. Use this to turn a vague prompt ("help me manage order exceptions") into concrete requirements, and as the checklist before calling a dashboard done.

Source: [FeatureVibe Product Doc](https://docs.google.com/document/d/1874rP_5_uMLzfF_kMGWYuSLvsW_PXVh4REg7pJeixT4/edit)

> **North Star.** A successful dashboard helps a site owner or collaborator **understand what matters, complete the intended task, and trust the result**. It fulfills the user's prompt through a clear workflow, the right presentation, and trustworthy business data.

This file is about *what to build*. For *how* to build it, see [WDS_LAYOUT.md](WDS_LAYOUT.md) for content layout and [DASHBOARD_PAGE.md](../DASHBOARD_PAGE.md) for the `@wix/patterns` → `@wix/design-system` component order — the workflow stages below are user needs, not an excuse to hand-roll shells, tables, or filter bars.


## The Success Model

A generated dashboard succeeds across three connected dimensions.

| Success dimension | What must be true |
|---|---|
| Workflow success | The dashboard supports a complete journey from understanding to a confirmed outcome. |
| Presentation success | Information is shown clearly and in the format that best supports the task. |
| Data success | Information is accurate and consistent, including when it comes from multiple sources. |


## The Workflow Journey

The prompt defines the outcome. The stages define the journey from understanding the situation to confirming the result. They are **user needs**, not necessarily separate screens or a rigid sequence.

| Stage | User outcome |
|---|---|
| **Understand** | Know the current situation. |
| **Focus** | Recognize what matters or requires attention. |
| **Investigate** | Access the details needed to decide. |
| **Act** | Complete the intended business task. |
| **Feedback** | See that the action succeeded and the state changed correctly. |

### 1. Understand

**Intent:** Help the user understand the business area this dashboard supports, what the data represents, and how to interpret it.

- Present the most important totals, trends, and status indicators.
- Make scope, time range, and freshness clear.
- Distinguish no data, loading, access, connection, and system problems.
- Connect summaries to underlying items.

**Success:** The user can explain what is happening now.

### 2. Focus

**Intent:** Help the user recognize what matters or requires attention.

- Choose the view that best supports the task.
- Reduce noise through hierarchy, search, filters, sorting, saved views, and alerts.
- Explain empty results and offer a useful next step.
- Make the most important next action clear.

**Success:** The user knows where to direct attention and what to do next.

### 3. Investigate

**Intent:** Give the user enough context to make a confident decision.

- Reveal detail progressively without making users lose their place.
- Show related information, history, and meaningful connections.
- Make missing, unmatched, or uncertain information visible.

**Success:** The user can understand why something happened and decide how to respond.

### 4. Act

**Intent:** Let the user complete the intended business task.

- Provide the actions required by the prompt and allowed by permissions.
- Support individual and bulk actions when both are useful.
- Make consequences clear and protect against destructive mistakes.

**Success:** The user can complete the task without leaving the workflow or guessing what to do.

### 5. Feedback

**Intent:** Confirm that the action succeeded and the business state changed correctly.

- Provide immediate feedback after an action.
- Refresh relevant items, summaries, counts, filters, and views.
- Keep status and history visible when users may need to return later.

**Success:** The user can see the confirmed result everywhere it matters.


## The 5 WHATs

How to gain enough context to ensure a complete workflow. Translate each prompt into concrete journey requirements:

- What outcome is the user trying to achieve?
- What must they understand before acting?
- What requires deeper investigation?
- Which actions must be available?
- What visible result will confirm success?

> **Example:** "Help me manage order exceptions" requires an overview of open issues, ways to focus on urgent cases, enough order context to decide, actions to resolve each issue, and confirmation that resolved items leave the active list.


## Presentation Success

Presentation success applies across all five stages. Choose both the right **representation** and the right **interaction surface**, while keeping hierarchy, meaning, and state consistent.

### Choosing the Right View

| View | Use when… | Success looks like… |
|---|---|---|
| **Table** | Users compare many records across several attributes. | Records are easy to scan, compare, filter, select, and act on. |
| **Gallery** | Visual recognition is central. | Images identify items while key status and actions remain visible. |
| **List** | Items have one dominant identity and limited supporting detail. | Users scan quickly without unnecessary density. |
| **Kanban** | Work moves through meaningful stages. | Stage, workload, and valid movement are understandable. |
| **Timeline or calendar** | Time, sequence, or scheduling matters. | Upcoming activity, conflicts, and timing are clear. |
| **Chart** | The user needs to understand a trend or relationship. | The visualization answers a specific business question. |
| **Summary metrics** | The user needs a quick health signal. | Metrics clarify current conditions and where to focus. |

- Choose the default view that best supports the primary task.
- Offer another view only when it provides distinct value.
- Keep filters, state, and meaning consistent when users change views.
- Connect summaries and visualizations back to the relevant records.

### Choosing the Right Drill-In

Choose the smallest interface that gives users enough context and room to complete the task. These are defaults, not rigid rules.

| Interface | Use when… | Success looks like… |
|---|---|---|
| **Side panel** | The user should review or update one item while keeping the dashboard visible. | Context is preserved while deeper work remains focused. |
| **Modal** | The user needs to complete a focused, bounded task or decision. | Attention stays on one task and the user can return cleanly. |
| **Entity page** | The task involves complex details, multi-section editing, history, or related information. | The user has enough space and structure to complete deeper work. |
| **Inline or expanded row** | The user needs a quick inspection or simple action. | Detail appears without creating a separate workspace. |


## Data Success

Data success means giving users a complete and trustworthy view of the business. A dashboard may rely on one source or connect related customer, transaction, payment, and operational data.

### Major Data Sources

| Data source | What it provides |
|---|---|
| **CMS** | Custom collections, items, references, and custom business records. |
| **Stores** | Products, variants, categories, inventory, and locations. |
| **eCommerce** | Carts, checkouts, orders, line items, and fulfillment. |
| **Bookings** | Services, appointments, classes, courses, staff, availability, and attendance. |
| **Contacts and Members** | Customer identity, profiles, labels, roles, and audience context. |
| **Payments and Pricing Plans** | Transactions, refunds, payouts, plans, subscriptions, and renewals. |
| **Events** | Events, tickets, registrations, guests, and check-ins. |
| **Other connected sources** | Restaurants, Forms, Invoices, Programs, and external systems. |

### What Must Succeed Across Sources

| Requirement | User outcome |
|---|---|
| **Meaningful relationship** | Sources combine around the business item or decision the user cares about. |
| **Consistent meaning** | Shared concepts use understandable and consistent language. |
| **Clear gaps** | Missing or unmatched information is visible rather than silently ignored. |
| **Trusted actions** | Actions update the correct source and the result appears everywhere relevant. |
| **Right level of combination** | Related items may be combined; useful but distinct sources remain separate. |

> The goal is not to merge everything. Combine sources when the relationship helps users understand or act; otherwise keep them separate but connected.

### Multi-Source Examples

| Single view | Primary record | Connected sources | User outcome |
|---|---|---|---|
| **Order exceptions** | eCommerce order | Payments, Contacts, Stores | Resolve unpaid, delayed, or incorrect orders from one queue. |
| **Booking follow-up** | Booking or appointment | Bookings, Contacts, Payments | Find missed or unpaid appointments and contact the client. |


## Evaluation

Rendering is not enough. A successful dashboard passes every check below.

- [ ] **Prompt fulfilled:** The main result requested by the user is delivered.
- [ ] **Task completion:** The intended task works from entry to confirmed result.
- [ ] **Presentation fit:** Layout, actions, and empty states make the task easy to understand and complete.
- [ ] **Trusted data:** All sources and views form one accurate picture of the business.
- [ ] **Consistent results:** Actions, filters, views, summaries, and details agree.
- [ ] **Business fit:** The experience matches the user's context, role, and permissions.

> **Final evaluation question.** Does this dashboard give the user a **clear, trustworthy, and effective** way to accomplish what they asked for?
