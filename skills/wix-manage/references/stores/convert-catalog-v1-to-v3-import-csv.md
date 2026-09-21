---
name: "Convert Catalog V1 Products to Catalog V3 Import CSV"
description: Export products from a Catalog V1 Wix Store and prepare Catalog V3 dashboard import CSV files, including media rows, category slugs, and safe under-10,000-row batching.
---
# RECIPE: Business Recipe - Convert Catalog V1 Products to Catalog V3 Import CSV

Use this recipe when a merchant needs to move products from an old Wix Stores Catalog V1 site into a Catalog V3 site by generating CSV files for the Wix Stores dashboard import flow.

This recipe is for export and file generation. Do not create, update, delete, or import products through APIs unless the user explicitly asks for that separate action.

---

## STEP 1: Confirm Source and Target Catalogs

1. Confirm the source site uses Catalog V1 before using V1 product endpoints.
2. Confirm the target site uses Catalog V3 before generating a V3 import CSV.
3. If you only have a CSV attachment from the source site, inspect the file header and existing row structure before transforming it.

Relevant supporting recipes:
- [Query Products (Catalog V1)](query-products-catalog-v1.md) for reading source products.
- [Setup Online Store (Catalog V3)](setup-online-store-catalog-v3.md) for confirming V3 target setup.

---

## STEP 2: Export Source Products and Collections

For Catalog V1 API export, use:
- `POST https://www.wixapis.com/stores-reader/v1/products/query`
- `POST https://www.wixapis.com/stores-reader/v1/collections/query`
- `GET https://www.wixapis.com/stores-reader/v1/products/{productId}?includeMerchantSpecificData=true` when the query response does not include all media, collection IDs, inventory, or option details needed for the CSV.

Build a collection lookup by ID so product collection IDs can be converted into V3 import `categorySlugs`.

Keep the product's stable handle consistent across all rows generated for that product. Prefer the source slug or normalized product name, and make it unique when duplicates exist.

---

## STEP 3: Build Product Groups, Not Independent Rows

Treat each product as one atomic CSV group:

1. Exactly one `PRODUCT` row for the product.
2. Zero or more `MEDIA` rows for that same handle, immediately after the `PRODUCT` row.

**CRITICAL:** Do not generate or split CSV files by raw row count alone. `MEDIA` rows depend on the matching `PRODUCT` row being present earlier in the same file. A file that starts with orphan `MEDIA` rows, or contains `MEDIA` rows whose product row is in another file, can fail the dashboard import with internal media errors such as `Cannot read properties of undefined (reading 'mediaInfo')`.

Safe row order for each product:

```text
handle,fieldType,...
classic-passport,PRODUCT,...
classic-passport,MEDIA,...
classic-passport,MEDIA,...
deluxe-passport,PRODUCT,...
deluxe-passport,MEDIA,...
```

Unsafe row order:

```text
handle,fieldType,...
classic-passport,MEDIA,...
classic-passport,MEDIA,...
```

---

## STEP 4: Split Into Under-10,000-Row Files Without Breaking Groups

The Wix Stores dashboard import processes up to 10,000 rows per file. Keep every generated file at or below 10,000 total CSV rows, including the header row, unless the dashboard explicitly states a different limit.

Use product-group-aware batching:

```javascript
const MAX_TOTAL_ROWS_PER_FILE = 10000;
const MAX_DATA_ROWS_PER_FILE = MAX_TOTAL_ROWS_PER_FILE - 1; // reserve header

function splitProductGroups(productGroups) {
  const files = [];
  let current = [];
  let currentRows = 0;

  for (const group of productGroups) {
    if (group.length > MAX_DATA_ROWS_PER_FILE) {
      throw new Error(
        `Product group for handle "${group[0]?.handle}" has ${group.length} rows and cannot fit in one import file. Reduce media rows for this product or split the product manually.`
      );
    }

    if (currentRows > 0 && currentRows + group.length > MAX_DATA_ROWS_PER_FILE) {
      files.push(current);
      current = [];
      currentRows = 0;
    }

    current.push(...group);
    currentRows += group.length;
  }

  if (currentRows > 0) {
    files.push(current);
  }

  return files;
}
```

Before giving the user files, validate each file:

- Total rows including header are `<= 10000`.
- The first data row is a `PRODUCT` row.
- Every `MEDIA` row handle has a preceding `PRODUCT` row with the same handle in the same file.
- No product handle appears across two different files.
- Every row has the same number of columns as the header.

If a product has more media rows than can fit in one file with its `PRODUCT` row, do not split that product across files. Reduce media rows for that product, ask the user how many images to keep, or produce a clear warning file/report.

---

## STEP 5: Explain Import Order and Recovery

Tell the user to import the generated files in order.

If a generated file fails:

1. Do not tell the user to keep retrying the same file unchanged.
2. Inspect whether the file begins with `MEDIA` rows or contains media handles without a matching preceding product row.
3. Regenerate the files with product-group-aware batching.
4. If the dashboard error mentions `mediaInfo`, treat orphan or cross-file media rows as the first issue to rule out before blaming the Stores importer.

## References

- [V1 Query Products](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v1/catalog/query-products)
- [V1 Query Collections](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v1/catalog/query-collections)
- [Catalog Versioning Overview](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-versioning/introduction)
