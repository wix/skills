# Wix Data SDK Reference

Complete reference for working with Wix Data collections in dashboard pages.

## Summary

- Read: `items.query('Collection').filter/sort.limit.find()` → `{ items, totalCount, hasNext }`
- Write: `items.insert | update | remove`. Ensure collection permissions allow the action

## WixDataItem Interface

The WixDataItem is the base interface for all data items in Wix Data collections. It includes:

- `[key: string]: any` - Additional custom fields defined in your collection schema

## Access Data Using Collection Schema

- Always use the exact field keys you defined in the collection schema.
- YOU MUST use the collection id exactly as you defined it in the collection schema.
- YOU MUST use the collection schema's exact field types for all operations (query, insert, update, remove)
- All custom fields are stored in the `[key: string]: any` part of the WixDataItem interface

## Example - Insert / Update / Delete

```typescript
import { items } from "@wix/data";

export type WixDataItem = items.WixDataItem;

/**
 * Creates a new item in the collection
 * @param collectionId - ID of the collection
 * @param itemData - Data for the new item
 * @returns Promise<T> - The created item
 */
async function createItem<T extends WixDataItem>(
  collectionId: string,
  itemData: T
): Promise<T> {
  try {
    const result = await items.insert(collectionId, itemData);
    return result as T;
  } catch (error) {
    console.error(`Error creating ${collectionId}:`, error);
    throw new Error(
      error instanceof Error
        ? error.message
        : `Failed to create ${collectionId}`
    );
  }
}

/**
 * Retrieves all items from the collection
 * @param collectionId - ID of the collection
 * @returns Promise<items.WixDataResult<T>> - Query result with all items
 */
async function getAllItems<T extends WixDataItem>(
  collectionId: string
): Promise<items.WixDataResult<T>> {
  try {
    const result = await items.query(collectionId).find();
    return result as items.WixDataResult<T>;
  } catch (error) {
    console.error(`Error fetching ${collectionId}s:`, error);
    throw new Error(
      error instanceof Error
        ? error.message
        : `Failed to fetch ${collectionId}s`
    );
  }
}

/**
 * Retrieves a single item by ID
 * @param collectionId - ID of the collection
 * @param itemId - ID of the item to retrieve
 * @returns Promise<T | null> - The item or null if not found
 */
async function getItemById<T extends WixDataItem>(
  collectionId: string,
  itemId: string
): Promise<T | null> {
  try {
    const result = await items.query(collectionId).eq("_id", itemId).find();

    if (result.items.length > 0) {
      return result.items[0] as T;
    }
    return null;
  } catch (error) {
    console.error(`Error fetching ${collectionId} by ID:`, error);
    throw new Error(
      error instanceof Error ? error.message : `Failed to fetch ${collectionId}`
    );
  }
}

/**
 * Updates an existing item
 * @param collectionId - ID of the collection
 * @param itemData - Updated item data (must include _id)
 * @returns Promise<T> - The updated item
 */
async function updateItem<T extends WixDataItem>(
  collectionId: string,
  itemData: T
): Promise<T> {
  try {
    // CRITICAL: TypeScript requires _id to be present and non-undefined
    if (!itemData._id) {
      throw new Error(`${collectionId} ID is required for update`);
    }

    // Ensure _id is explicitly included to satisfy TypeScript strict null checks
    const result = await items.update(collectionId, {
      ...itemData,
      _id: itemData._id, // Explicitly include _id to satisfy type checker
    });
    return result as T;
  } catch (error) {
    console.error(`Error updating ${collectionId}:`, error);
    throw new Error(
      error instanceof Error
        ? error.message
        : `Failed to update ${collectionId}`
    );
  }
}

/**
 * Deletes an item by ID
 * @param collectionId - ID of the collection
 * @param itemId - ID of the item to delete
 * @returns Promise<T> - The deleted item
 */
async function deleteItem<T extends WixDataItem>(
  collectionId: string,
  itemId: string
): Promise<T> {
  try {
    if (!itemId) {
      throw new Error(`${collectionId} ID is required for deletion`);
    }

    const result = await items.remove(collectionId, itemId);
    return result as T;
  } catch (error) {
    console.error(`Error deleting ${collectionId}:`, error);
    throw new Error(
      error instanceof Error
        ? error.message
        : `Failed to delete ${collectionId}`
    );
  }
}
```

## Date/Time Handling

- **Date (date-only)**: Store as a string in "YYYY-MM-DD" format (as returned by `<input type="date" />`).
- **DateTime (date + time)**: Store as a Date object. Accept the YYYY-MM-DDTHH:mm format returned by `<input type="datetime-local" />` and convert to a Date object using `new Date()`.
- **Time (time-only)**: Store as a string in HH:mm or HH:mm:ss 24-hour format (as returned by `<input type="time" />`).
- Use native JavaScript Date methods for parsing, formatting, and manipulating dates/times (e.g., `new Date()`, `toISOString()`, `toLocaleString()`, `toLocaleDateString()`).
- Always validate incoming date/time values and provide graceful fallback or explicit error handling when values are invalid.
