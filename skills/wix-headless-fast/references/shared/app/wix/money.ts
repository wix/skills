// Money formatting for API amounts that carry no formatted string. Copy as-is.
//
// Catalog prices come with a ready `formattedAmount` — use that directly. But eCom Cart V2
// amounts are ConvertedMoney `{ amount, convertedAmount }` with NO formatted string, and the
// currency lives on the cart, not on the money object. Never hardcode "$" or assume USD.
export interface ConvertedMoneyLike {
  amount?: string | null;
  convertedAmount?: string | null;
}

/** Format a ConvertedMoney in the given currency, using the visitor's locale. */
export function formatMoney(
  money: ConvertedMoneyLike | null | undefined,
  currencyCode: string | null | undefined,
): string {
  const value = money?.convertedAmount ?? money?.amount;
  if (value == null || value === "") return "";
  const currency = currencyCode || "USD";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(value));
  } catch {
    return `${value} ${currency}`;
  }
}
