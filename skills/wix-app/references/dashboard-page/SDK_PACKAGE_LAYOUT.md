# Where the SDK types actually live

A Wix vertical package such as `@wix/ecom` is a thin re-export barrel. `build/es/index.d.mts` is a
list of namespaces (`orders`, `orderTransactions`, `currentCart`, …), each re-exported from its own
generated package:

```
node_modules/@wix/ecom/build/es/index.d.mts          # namespace list only, ~90 lines
node_modules/@wix/auto_sdk_ecom_orders/build/es/
  index.d.mts                                        # the callable functions
  index.typings.d.mts                                # request/response types
  ecom-v1-order-orders.universal-<hash>.d.mts        # the domain entities
```

Three consequences:

1. **The directory name is not the namespace name.** `extendedBookings` lives in
   `auto_sdk_bookings_extended-bookings`. Don't derive one from the other; the SDK lookup maps them.
2. **The entity is not always in `index.typings.d.mts`.** `Order`, `Refund`, `Service` live in the
   hashed `*.universal-*.d.mts` when the package has one. The hash changes between versions, so glob
   for it, never hard-code it, and fall back to `index.typings.d.mts` when no universal file exists.
3. **Never `cat` *or plain-`grep`* the barrel's export block.** These files end with a single
   several-hundred-KB `export { … as a, … as b }` line, so `grep -n "queryServices" index.d.mts`
   prints that whole line. Anchor to the declarations instead —
   `grep -oE "^declare (const|function) [a-zA-Z]+"` — or pipe any barrel grep through `cut -c1-200`.

