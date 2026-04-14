---
name: "Send MCP Feedback"
description: Sends feedback about Wix MCP tools to Wix for product improvement. Used for bug reports, feature requests, and general feedback.
---
# Send MCP Feedback to Wix

This recipe demonstrates how to send feedback about the Wix MCP (Model Context Protocol) tools to Wix for product improvement.

## Overview

When users have feedback about their experience using Wix MCP tools with AI assistants, this API allows sending that feedback directly to Wix for tracking and improvement.

## Required APIs

- **Feedback API**: `POST https://www.wixapis.com/mcp-serverless/v1/feedback`

---

## Send Feedback

**Endpoint**: `POST https://www.wixapis.com/mcp-serverless/v1/feedback`

**Request Body**:
```json
{
  "message": "User feedback message here"
}
```

**Request**:
```bash
curl -X POST \
  'https://www.wixapis.com/mcp-serverless/v1/feedback' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "message": "The booking flow worked great but I had trouble with payment integration."
  }'
```

**Response**: Empty body on success.

---

## When to Use

Send feedback when users:
- Have suggestions for MCP tool improvements
- Report issues or bugs with MCP functionality
- Share positive experiences
- Request new features

### IMPORTANT NOTES:
- Messages cannot be replied to or tracked by the user
- Feedback is used by Wix to improve MCP tools
- Include specific details about the context and issue

---

## Example Feedback Messages

### Bug Report
```json
{
  "message": "When creating a booking with the CreateBooking tool, the response sometimes doesn't include the booking ID."
}
```

### Feature Request
```json
{
  "message": "Would be helpful if the QueryProducts tool supported filtering by stock status."
}
```

### Positive Feedback
```json
{
  "message": "The new SearchWixRESTDocumentation tool is very helpful for finding the right API endpoints quickly."
}
```
