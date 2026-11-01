# Events context: `@wix/events/context/event-by-id` (part 5 of 6)

This context's reference is split across 6 files: [event-by-id.md](event-by-id.md), [event-by-id-2.md](event-by-id-2.md), [event-by-id-3.md](event-by-id-3.md), [event-by-id-4.md](event-by-id-4.md), [event-by-id-5.md](event-by-id-5.md), [event-by-id-6.md](event-by-id-6.md).

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/events/context/event-by-id`.

##### `Event$1`

| Property | Type | Description |
| --- | --- | --- |
| `_id` | `string \| undefined` | Event ID. |
| `location` | `Location$1 \| undefined` | Event location. |
| `dateAndTimeSettings` | `DateAndTimeSettings$1 \| undefined` | Event date and time settings. |
| `title` | `string \| null \| undefined` | Event title. |
| `shortDescription` | `string \| null \| undefined` | Short description that appears under the event title. **Note:** This field is returned only when the `DETAILS` fieldset is included in the request. |
| `detailedDescription` | `string \| null \| undefined` | Detailed description of an event. This field is deprecated. |
| `mainImage` | `string \| undefined` | Main event image. <br> **Note:** This field is returned only when the `DETAILS` fieldset is included in the request. |
| `slug` | `string \| undefined` | Unique identifier of the event page. The naming is the same as the event title written in kebab case. For example, if your event title is "Leather Crafting 101", then the slug is "leather-crafting-101". |
| `_createdDate` | `Date \| null \| undefined` | Date and time when the event was created. |
| `_updatedDate` | `Date \| null \| undefined` | Date and time when the event was updated. |
| `status` | `StatusWithLiterals$1 \| undefined` | Event status. |
| `registration` | `Registration \| undefined` | RSVP or ticketing registration details. <br> **Note:** This field is returned only when the `REGISTRATION` fieldset is included in the request. |
| `calendarUrls` | `CalendarUrls \| undefined` | URLs that allow you to add an event to the Google calendar, or to download an [ICS calendar](https://icscalendar.com/) file. <br> **Note:** This field is returned only when the `DETAILS` fieldset is included in the request. |
| `eventPageUrl` | `string \| undefined` | Event page URL components. <br> **Note:** This field is returned only when the `URLS` fieldset is included in the request. |
| `form` | `Form \| undefined` | Event registration form. <br> **Note:** This field is returned only when the `FORM` fieldset is included in the request. |
| `summaries` | `Summaries \| undefined` | Summary of RSVP or ticket sales. <br> **Note:** This field is returned only when the `DASHBOARD` fieldset is included in the request and you have the "WIX_EVENTS.READ_EVENT_DASHBOARD" permissions. |
| `instanceId` | `string \| undefined` | Instance ID of the site where the event is hosted. |
| `guestListSettings` | `GuestListSettings \| undefined` | Guest list configuration. |
| `userId` | `string \| undefined` | ID of the user who created the event. |
| `onlineConferencing` | `OnlineConferencing \| undefined` | Online conferencing details. <br> **Note:** This field is returned only when the `ONLINE_CONFERENCING_SESSION` fieldset is included in the request and you have the "WIX_EVENTS.READ_ONLINE_CONFERENCING" permissions. |
| `seoSettings` | `SeoSettings \| undefined` | SEO settings. <br> **Note:** This field is returned only when the `SEO_SETTINGS` fieldset is included in the request. |
| `contactLabel` | `string \| null \| undefined` | Legacy contacts label key. <br> **Note:** Populated only on events created before the migration to Contacts V5; new events aren't assigned a contacts label. |
| `agendaSettings` | `AgendaSettings \| undefined` | Event schedule details. <br> **Note:** This field is returned only when the `AGENDA` fieldset is included in the request. |
| `eventDisplaySettings` | `EventDisplaySettings \| undefined` | Visual settings for event. |
| `description` | `RichContent$1 \| undefined` | Event description. <widget src="https://apps.wix.com/_serverless/ricos-playground-services/goto/api-component" plugins="emoji,audio,codeBlock,collapsibleList,divider,emoji,file,gallery,giphy,hashtag,heading,html,image,indent,lineSpacing,link,linkPreview,spoiler,video" exampleid="9b569a8d-0fc1-40f4-987f-8bd40ecc72d0">Fallback Message for SSR and Error</widget> |
| `publishedDate` | `Date \| null \| undefined` | Event publish timestamp. |

##### `TicketDefinition$1`

| Property | Type | Description |
| --- | --- | --- |
| `_id` | `string \| null \| undefined` | Ticket definition ID. |
| `eventId` | `string \| null \| undefined` | Event ID to which the ticket definition belongs. |
| `revision` | `string \| null \| undefined` | Revision number, which increments by 1 each time the ticket definition is updated. To prevent conflicting changes, the existing `revision` must be used when updating a ticket definition. |
| `_createdDate` | `Date \| null \| undefined` | Date and time the ticket definition was created. |
| `_updatedDate` | `Date \| null \| undefined` | Date and time the ticket definition was updated. |
| `name` | `string \| null \| undefined` | Ticket definition name. |
| `description` | `string \| null \| undefined` | Ticket definition description. |
| `policyText` | `string \| null \| undefined` | Ticket definition policy. |
| `hidden` | `boolean \| undefined` | Whether this ticket definition is hidden from site visitors and can't be purchased. |
| `limited` | `boolean \| undefined` | Whether the ticket has a limited maximum quantity. |
| `initialLimit` | `number \| null \| undefined` | The maximum number of tickets that can be sold for the event when first defining the event. If a seating map is defined after you created a ticket definition, this property is ignored and `actualLimit` is used instead. To create unlimited tickets, skip this field in the request. |
| `actualLimit` | `number \| null \| undefined` | The maximum number of tickets that can be sold for the event after adding a seating map to the event. If no seating map is defined, this property is the same as `initialLimit`. |
| `pricingMethod` | `PricingMethod \| undefined` | Ticket pricing method. |
| `feeType` | `FeeTypeEnumTypeWithLiterals \| undefined` | Type of ticket service fee to collect. |
| `salePeriod` | `SalePeriod \| undefined` | Ticket sale period. |
| `saleStatus` | `SaleStatusEnumStatusWithLiterals \| undefined` | Ticket sale status. |
| `salesDetails` | `SalesDetails \| undefined` | Ticket sales information. <br> <br> **Note:** This field is only returned when `SALES_DETAILS` is specified in `field` in the request. |
| `limitPerCheckout` | `number \| null \| undefined` | Number of tickets that can be purchased per checkout. <br> <br> **Note:** If the `actualLimit` or `salesDetails.unsoldCount` field value is smaller than `limitPerCheckout`, then it overrides this field. |
| `extendedFields` | `ExtendedFields$1 \| undefined` | Data extensions. |
| `eventDetails` | `EventDetails \| undefined` | Information about the even the ticket is for. <br> **Note:** This field is only returned when `EVENT_DETAILS` is specified in `field` in the request. |
| `seatingDetails` | `SeatingDetails \| undefined` | Seating information including available seats and areas for this ticket definition. <br> **Note:** This field is only returned when `SEATING_DETAILS` is specified in `field` in the request, and when the event has a [seating plan](https://support.wix.com/en/article/wix-events-creating-a-seating-map). |

##### `PlanInfo`

| Property | Type | Description |
| --- | --- | --- |
| `id` | `string` | Plan ID. To retrieve or manage the plan, use the [Plans V3 API](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/plans-v3/introduction). |
| `name` | `string` | Name of the plan. |
| `status` | `PlanStatus` | Status of the plan. |
| `visible` | `boolean` | Whether the plan is visible to site visitors. |
| `purchased` | `boolean` | Whether the site member bought the plan. |
| `discount` | `{ moneyOffAmount?: string \| undefined; percentOffRate?: string \| undefined; } \| undefined` | Discount the plan gives on the event's tickets. |
| `credits` | `number \| undefined` | Number of the event's tickets that the plan's discount applies to. |
| `remainingCredits` | `number` | Number of discounted tickets the site member has left on the plan. |
| `planOrderId` | `string` | ID of the site member's order for the plan. |
| `benefitId` | `string` | ID of the plan's benefit that gives the discount on the event's tickets. |
| `plan` | `Plan$1 \| undefined` | Details of the plan, such as its pricing, from the [Plans V3 API](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/plans-v3/introduction). |
