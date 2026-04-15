---
name: "List Events"
description: Queries events from Wix Events using Events API. Covers field sets (DETAILS, URLS, REGISTRATION), filtering by status/date, and pagination.
---
# List Events with Wix Events API

This recipe demonstrates how to query and list events from Wix Events using the REST API.

## Prerequisites

- Wix Events app installed on the site
- API access with events permissions

## Required APIs

- **Events API**: [REST](https://dev.wix.com/docs/rest/business-solutions/events/events-v3/query-events)
- **Filter and Sort Guidelines**: [Documentation](https://dev.wix.com/docs/rest/business-solutions/events/events-v3/filter-and-sort)

---

## Step 1: Verify Events App is Installed

Before querying events, ensure Wix Events is installed on the site. If not, use the [Install Wix Apps](../app-installation/install-wix-apps.md) recipe to install it.

---

## Step 2: Query Events

**Endpoint**: `POST https://www.wixapis.com/events/v3/events/query`

**Request Body**:
```json
{
  "query": {
    "paging": {
      "limit": 10
    }
  },
  "fields": ["DETAILS", "URLS"]
}
```

**Request**:
```bash
curl -X POST \
  'https://www.wixapis.com/events/v3/events/query' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "query": {
      "paging": {
        "limit": 10
      }
    },
    "fields": ["DETAILS", "URLS"]
  }'
```

### Available Field Sets

The `fields` parameter determines which data is returned. You MUST specify at least `"DETAILS"`.

| Field Set | Description |
|-----------|-------------|
| `DETAILS` | Core event information (required) |
| `URLS` | Event page URLs |
| `CATEGORIES` | Event categories |
| `AGENDA` | Event schedule/agenda |
| `SEO_SETTINGS` | SEO metadata |
| `REGISTRATION` | Registration settings |
| `TEXTS` | Custom text content |
| `FORM` | Registration form configuration |
| `DASHBOARD` | Dashboard settings |
| `FEED` | Social feed settings |
| `ONLINE_CONFERENCING_SESSION` | Virtual event settings |

### IMPORTANT NOTES:
- I MUST specify at least `"DETAILS"` in the `fields` array
- I MUST NEVER use `"FULL"` as a field value
- If the user wants event links, I MUST include `"URLS"` in the fields
- Follow the [Filter and Sort Guidelines](https://dev.wix.com/docs/rest/business-solutions/events/events-v3/filter-and-sort) for query filtering

---

## Step 3: Filter Events (Optional)

Apply filters to narrow down results:

**Filter by Status**:
```json
{
  "query": {
    "filter": {
      "status": "UPCOMING"
    },
    "paging": {
      "limit": 10
    }
  },
  "fields": ["DETAILS"]
}
```

> **Note:** Valid status values are: `UPCOMING`, `STARTED`, `ENDED`, `CANCELED`, `DRAFT`.

**Filter by Date Range**:
```json
{
  "query": {
    "filter": {
      "dateAndTimeSettings.startDate": {
        "$gte": "2024-01-01T00:00:00Z",
        "$lte": "2024-12-31T23:59:59Z"
      }
    },
    "paging": {
      "limit": 10
    }
  },
  "fields": ["DETAILS"]
}
```

---

## Response Structure

```json
{
  "events": [
    {
      "id": "event-id-123",
      "title": "Event Title",
      "shortDescription": "Event description",
      "status": "UPCOMING",
      "dateAndTimeSettings": {
        "startDate": "2024-06-15T10:00:00Z",
        "endDate": "2024-06-15T18:00:00Z",
        "timeZoneId": "America/New_York",
        "dateAndTimeTbd": false,
        "recurrenceStatus": "ONE_TIME"
      },
      "location": {
        "type": "VENUE",
        "address": {}
      },
      "slug": "event-slug"
    }
  ],
  "pagingMetadata": {
    "count": 10,
    "hasNext": true
  }
}
```

---

## Common Use Cases

### List Upcoming Events
```json
{
  "query": {
    "filter": {
      "status": "UPCOMING",
      "dateAndTimeSettings.startDate": {
        "$gte": "2024-01-01T00:00:00Z"
      }
    },
    "sort": [
      {
        "fieldName": "dateAndTimeSettings.startDate",
        "order": "ASC"
      }
    ],
    "paging": {
      "limit": 20
    }
  },
  "fields": ["DETAILS", "URLS"]
}
```

### List Events with Registration Info
```json
{
  "query": {
    "paging": {
      "limit": 10
    }
  },
  "fields": ["DETAILS", "REGISTRATION", "FORM"]
}
```

---

## Next Steps

- Create events using the [Create Event API](https://dev.wix.com/docs/rest/business-solutions/events/events-v3/create-event)
- Manage RSVPs and registrations
- Configure event tickets and pricing
