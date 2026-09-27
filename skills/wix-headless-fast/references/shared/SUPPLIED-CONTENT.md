# Supplied content — when the user brings their own

When the brief supplies the content in any form — a CSV, JSON or spreadsheet, a list typed in the
prompt, a PDF or an image of a price list or a menu, a folder of photos with a text file beside
it, a link to a page that lists it — that source is the seed plan. The vertical's default count
("start with 3", "a few posts") applies only to catalogs you draft yourself.

Read it however it needs to be read: parse the file (a quoted comma inside a description is
common), open the PDF, fetch the page, look at the images. Then map, don't author:

- Every entry in the source becomes an entry in the plan. Names, titles, descriptions, prices,
  dates verbatim; never rename, reprice, reword, reorder or add.
- Column and field names vary; map by meaning to the fields the vertical's `SEED.md` plan
  shape defines. Anything the plan has no field for is dropped — say which columns you dropped.
- Their images only: an image URL column → the plan's image URL field, verified with `curl -sI`
  → 200; a local file → the plan's image path field. An entry with no image is seeded without one
  and listed in your summary. **Never an `imagePrompt` beside supplied content** — these are their
  things, not a mood board.
- Currency, time zone, address: only when the source or the brief states them.
- Show the user the count you read next to the count you seeded, and the mapping you applied.

The vertical's `SEED.md` says what an entry is for that vertical and which of its plan fields the
usual columns land in.
