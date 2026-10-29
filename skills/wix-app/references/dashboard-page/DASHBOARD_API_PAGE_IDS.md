# Dashboard API Reference: page IDs

Part of the [Dashboard API Reference](DASHBOARD_API.md).

## Page IDs

Common Wix dashboard page IDs useful for navigation. Use with `dashboard.navigate({ pageId })`.

**Selection policy:**
- When asked to navigate by page name, choose the closest match from the list below.
- Prefer exact match; otherwise use common aliases/synonyms.
- Do not default to "Home" unless the user asks for home or no reasonable match exists.
- If multiple names share the same ID, treat them as aliases.

**ID formats:**
- Most IDs are GUIDs. Some are slugs (e.g., "wix-restaurants-orders-new", "restaurants_orders"). Use them as-is.

**Aliases/synonyms (non-exhaustive):**
- Products List: product list, products page, catalog, product catalog, inventory products
- Automatic Discounts ↔ Coupons

**Page IDs:**
- Abandoned Carts: bb407b4d-6df5-4607-81df-6cd9ecf5d229
- Activity: dfad075a-1ab3-458c-a77b-8fc9f509eaca
- Accept Payments Page: abe22932-49cb-43e0-b22d-8e342482113e
- Automatic Discounts: ed0163bf-ddeb-4dbe-8042-648b44bcbaac
- Automations: 67028126-3a56-43dd-9ed2-0c9c875e739c
- Back in Stock Requests: 74ff0096-6e7f-4d40-9f72-e85a2a7d5726
- Behavior Overview: d53c7001-5056-48d3-81e8-5320f9ef08e4
- Bookings Settings: bcdb42a8-2423-4101-add6-cbebc1951bc2
- Blog Overview: a7f877e0-69ac-459f-8b5b-eb7c5e25bad2
- Blog Writers: b8c96d90-95d6-57de-9a97-0d44c4dfaa96
- Business Cards: 44a21d57-98a3-486f-9def-5e5f356363b5
- Business Email Settings: bfd22a01-fc5b-4b53-940d-beaeac065230
- Contacts List: bdd09dca-7cc9-4524-81d7-c9336071b33e
- Contacts Segments: 0f410434-052f-4edb-8a89-ef564e4465e5
- Contacts Workflows: 511fe7f0-d0fe-4acb-84bc-b9887e4c92b7
- Content Manager: 6513755b-2a3b-45b9-8172-99c16e00dfde
- Coupons: ed0163bf-ddeb-4dbe-8042-648b44bcbaac
- Domain Connection: 3aeabb6d-0bc6-4b88-a6ba-3b40096a9c3a
- Email Marketing: 2abbf001-de3d-4b60-a186-28afd3f4c7ac
- Facebook and Instagram Ads: 4ada9d29-ff4d-40b6-802e-97dbd661fd7c
- Find Products to Sell: 958a5f12-e276-4dee-9c05-4aa880f31932
- Forms & Submissions: 8b307095-20c5-48a8-a36e-6c7ad6f11552
- Forum Categories: d6d2f9e8-43a7-4781-8e3c-4da93f91ea45
- Forum Posts: 6ce59b51-95ce-485e-a158-42686d647793
- Forum Settings: b1b1df78-6340-4ef0-b576-5dab0b2602e3
- Gift Card Overview: 99bc7dcb-312d-4462-9ff6-ca764606cfbb
- Gift Card Sales: 8bae1213-e243-4cd5-910b-9c3d4b6c0750
- Google Business Profile: 98b6ed3b-9ac6-486f-a347-0de6f9929965
- Home: 2e96bad1-df32-47b6-942f-e3ecabd74e57
- Import Contacts Page: 135f0c27-4fb9-453d-8479-7f8762227234
- Inbox: 1ae6068f-0fe6-4986-975a-3565f4147fbe
- Integrations: 02bba945-0d2c-4173-838e-cf186d57d9c8
- Inventory: 59a8855e-515a-49c1-894a-035731d2fd44
- Invoices: 237552b5-9d8e-4bdc-a39b-6e70a83caea0
- Language and Region Settings: f1f1abd6-3949-4633-a6dc-74337c70957a
- Logs: 4576d2f4-7da6-4ad1-ad51-418e09847e34
- Loyalty Program: c3ad65e1-0b0f-4da9-a8a3-6025c321da50
- Manage Loyalty Program: 978a178c-a739-46ed-93c3-60afaabd6ca4
- Marketing Home: 6617e07c-c3f3-45eb-9280-b41f23f259dd
- Manage Installed Apps: ad471122-7305-4007-9210-2a764d2e5e57
- Monitoring: e1a20a83-1908-4bae-9214-b9e26e6fda2a
- Music Library: 5da7cc0e-93e2-49cf-b8fa-de46be1af7b7
- My Albums: ef237a91-20b1-4e62-bbd7-31e28bda04a0
- Notification You Get - settings: e96a4137-cf9d-42ba-96c2-b583fce6f00b
- Notifications You Send - settings: e6576ec0-802c-4816-a84e-a206a10e7b3d
- New Order Form: a0278851-325c-4115-9bf1-08848468ad45
- Orders List: 8107f05f-d646-4c81-be90-adf28d321398
- Payments Dashboard: efe44d1d-506c-46c7-a770-e212b697acf0
- Price Quotes: 9f45b934-56a1-4036-96eb-4f6e2ff15c73
- Pricing Plans: e7b7afbb-6d4e-46b2-8bd6-0af78dc9d21e
- Products List: 0845ada2-467f-4cab-ba40-2f07c812343d
- Programs: ccf2fe64-86c2-44a3-8e97-eed943c49b58
- Recurring Invoices: 5bfd82d5-51e0-4dc0-aab9-9b384bf15f5d
- Restaurants Menus (New): 37c3de13-6224-42ee-bd80-308d452a2c7d
- Restaurants Menus: b278a256-2757-4f19-9313-c05c783bec92
- Restaurant Orders (New): wix-restaurants-orders-new
- Orders: 2c7daf4b-dbe7-4e00-9ffd-9b44b1884507
- Restaurant Orders: restaurants_orders
- Pricing Plans Settings: ce9562b2-f279-4c45-bee8-af3870d27069
- Roles And Permissions: ca4fc2e2-e8fc-4b4c-bfa0-32479931a00a
- Sales Overview: 98052ea0-bfe4-4095-88ba-d5c65c03254b
- Secrets Manager: f94ac43e-52c4-4564-b1da-68df51b9e614
- Settings Page: 50103805-f706-428a-ab43-04579324d067
- SEO - Get Found on Google: baf8b254-72c1-417b-a546-ecc9d869aa71
- SEO Overview: 721868b6-1d4d-4a40-a876-786f6cbfffcc
- Shipping and Delivery Settings: 26128445-061b-4dfc-bc44-fd53b13dd687
- Site Alerts: cabc24b1-fb28-445f-b38f-4db49aa26a58
- Site History: 122ec73e-4e5d-4c3a-ad62-3f62bdb31e0f
- Site Groups: 04c7e480-f1ad-4742-81f6-ac0edfd8a350
- Site Insights: 7f57c576-7911-46cf-abee-cd8905e59a21
- Site Reports: 66aeefcd-3e60-4b41-8991-934c5ee331ec
- Site Members: c696eca6-7489-40ae-8c41-815cea571b53
- Social Media Marketing: 36f17da6-ba4a-4657-af44-a45196771850
- Staff Management: a4f36fac-ea18-483b-8236-095e29fcb726
- New Staff Member Page: 3e6d608b-bbc2-4e72-a1ef-4d441bb113ad
- Subscriptions: 79dbb935-d823-4feb-9272-ef2cbcf2aafd
- Table Reservations: e4d65aa4-30ba-4700-ad47-28765d4cf3bc
- Tasks & Reminders: e1d6190c-bb9b-41b8-aa67-6024d19442e1
- Tax Settings: 7f43cf15-e14a-48f7-a7fa-9d0d1b1a6f02
- Triggered Emails: 9b111e6f-76c4-48e9-89cb-99e804ce6d31
- New Triggered Email form: bf982c96-9bb7-49e1-8116-be03aa1fc0d5
- Video Library: a9e63e77-29c6-4822-8687-51fa4bdd2279
- Website Settings: 29570214-f230-4228-9209-f09efb53f768
- Wix App Market: e839f784-0e31-45e6-8de8-426824a6dc2d
