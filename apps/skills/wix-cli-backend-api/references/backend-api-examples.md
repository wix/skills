# Examples

This document contains examples from the backend API system prompt instructions.

## Dynamic Route Example

Example for dynamic route from the system prompt:

```typescript
// src/pages/api/user/[id].ts

export async function GET({ params }) {
  const id = params.id;
  const user = await getUser(id);

  if (!user) {
    return new Response(null, {
      status: 404,
      statusText: "Not found",
    });
  }

  return new Response(JSON.stringify(user), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
```
