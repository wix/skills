# Stores context: `@wix/stores/context/product-list` (part 2 of 3)

This context's reference is split across 3 files: [product-list.md](product-list.md), [product-list-2.md](product-list-2.md), [product-list-3.md](product-list-3.md).

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/stores/context/product-list`.

##### `SortTypes`

| Property | Type | Description |
| --- | --- | --- |
| `toString` | `() => string` | Returns a string representation of a string. |
| `charAt` | `(pos: number) => string` | Returns the character at the specified index. |
| `charCodeAt` | `(index: number) => number` | Returns the Unicode value of the character at the specified location. |
| `concat` | `(...strings: string[]) => string` | Returns a string that contains the concatenation of two or more strings. |
| `indexOf` | `(searchString: string, position?: number \| undefined) => number` | Returns the position of the first occurrence of a substring, or -1 if it is not present. |
| `lastIndexOf` | `(searchString: string, position?: number \| undefined) => number` | Returns the last occurrence of a substring in the string, or -1 if it is not present. |
| `localeCompare` | `{ (that: string): number; (that: string, locales?: string \| string[] \| undefined, options?: CollatorOptions \| undefined): number; (that: string, locales?: LocalesArgument, options?: CollatorOptions \| undefined): number; }` | Determines whether two strings are equivalent in the current locale. Determines whether two strings are equivalent in the current or specified locale. |
| `match` | `{ (regexp: string \| RegExp): RegExpMatchArray \| null; (matcher: { [Symbol.match](string: string): RegExpMatchArray \| null; }): RegExpMatchArray \| null; }` | Matches a string with a regular expression, and returns an array containing the results of that search. Matches a string or an object that supports being matched against, and returns an array containing the results of that search, or null if no matches are found. |
| `replace` | `{ (searchValue: string \| RegExp, replaceValue: string): string; (searchValue: string \| RegExp, replacer: (substring: string, ...args: any[]) => string): string; (searchValue: { [Symbol.replace](string: string, replaceValue: string): string; }, replaceValue: string): string; (searchValue: { [Symbol.replace](string: string, replacer: (substring: string, ...args: any[]) => string): string; }, replacer: (substring: string, ...args: any[]) => string): string; }` | Replaces text in a string, using a regular expression or search string. Passes a string and {@linkcode replaceValue} to the `[Symbol.replace]` method on {@linkcode searchValue}. This method is expected to implement its own replacement algorithm. Replaces text in a string, using an object that supports replacement within a string. |
| `search` | `{ (regexp: string \| RegExp): number; (searcher: { [Symbol.search](string: string): number; }): number; }` | Finds the first substring match in a regular expression search. |
| `slice` | `(start?: number \| undefined, end?: number \| undefined) => string` | Returns a section of a string. |
| `split` | `{ (separator: string \| RegExp, limit?: number \| undefined): string[]; (splitter: { [Symbol.split](string: string, limit?: number \| undefined): string[]; }, limit?: number \| undefined): string[]; }` | Split a string into substrings using the specified separator and return them as an array. |
| `substring` | `(start: number, end?: number \| undefined) => string` | Returns the substring at the specified location within a String object. |
| `toLowerCase` | `() => string` | Converts all the alphabetic characters in a string to lowercase. |
| `toLocaleLowerCase` | `{ (locales?: string \| string[] \| undefined): string; (locales?: LocalesArgument): string; }` | Converts all alphabetic characters to lowercase, taking into account the host environment's current locale. |
| `toUpperCase` | `() => string` | Converts all the alphabetic characters in a string to uppercase. |
| `toLocaleUpperCase` | `{ (locales?: string \| string[] \| undefined): string; (locales?: LocalesArgument): string; }` | Returns a string where all alphabetic characters have been converted to uppercase, taking into account the host environment's current locale. |
| `trim` | `() => string` | Removes the leading and trailing white space and line terminator characters from a string. |
| `length` | `number` | Returns the length of a String object. |
| `substr` | `(from: number, length?: number \| undefined) => string` | Gets a substring beginning at the specified location and having the specified length. |
| `valueOf` | `() => string` | Returns the primitive value of the specified object. |
| `codePointAt` | `(pos: number) => number \| undefined` | Returns a nonnegative integer Number less than 1114112 (0x110000) that is the code point value of the UTF-16 encoded code point starting at the string element at position pos in the String resulting from converting this object to a String. If there is no element at that position, the result is undefined. If a valid UTF-16 surrogate pair does not begin at pos, the result is the code unit at pos. |
| `includes` | `(searchString: string, position?: number \| undefined) => boolean` | Returns true if searchString appears as a substring of the result of converting this object to a String, at one or more positions that are greater than or equal to position; otherwise, returns false. |
| `endsWith` | `(searchString: string, endPosition?: number \| undefined) => boolean` | Returns true if the sequence of elements of searchString converted to a String is the same as the corresponding elements of this object (converted to a String) starting at endPosition – length(this). Otherwise returns false. |
| `normalize` | `{ (form: "NFC" \| "NFD" \| "NFKC" \| "NFKD"): string; (form?: string \| undefined): string; }` | Returns the String value result of normalizing the string into the normalization form named by form as specified in Unicode Standard Annex #15, Unicode Normalization Forms. |
| `repeat` | `(count: number) => string` | Returns a String value that is made from count copies appended together. If count is 0, the empty string is returned. |
| `startsWith` | `(searchString: string, position?: number \| undefined) => boolean` | Returns true if the sequence of elements of searchString converted to a String is the same as the corresponding elements of this object (converted to a String) starting at position. Otherwise returns false. |
| `anchor` | `(name: string) => string` | Returns an `<a>` HTML anchor element and sets the name attribute to the text value |
| `big` | `() => string` | Returns a `<big>` HTML element |
| `blink` | `() => string` | Returns a `<blink>` HTML element |
| `bold` | `() => string` | Returns a `<b>` HTML element |
| `fixed` | `() => string` | Returns a `<tt>` HTML element |
| `fontcolor` | `(color: string) => string` | Returns a `<font>` HTML element and sets the color attribute value |
| `fontsize` | `{ (size: number): string; (size: string): string; }` | Returns a `<font>` HTML element and sets the size attribute value |
| `italics` | `() => string` | Returns an `<i>` HTML element |
| `link` | `(url: string) => string` | Returns an `<a>` HTML element and sets the href attribute value |
| `small` | `() => string` | Returns a `<small>` HTML element |
| `strike` | `() => string` | Returns a `<strike>` HTML element |
| `sub` | `() => string` | Returns a `<sub>` HTML element |
| `sup` | `() => string` | Returns a `<sup>` HTML element |
| `padStart` | `(maxLength: number, fillString?: string \| undefined) => string` | Pads the current string with a given string (possibly repeated) so that the resulting string reaches a given length. The padding is applied from the start (left) of the current string. |
| `padEnd` | `(maxLength: number, fillString?: string \| undefined) => string` | Pads the current string with a given string (possibly repeated) so that the resulting string reaches a given length. The padding is applied from the end (right) of the current string. |
| `trimEnd` | `() => string` | Removes the trailing white space and line terminator characters from a string. |
| `trimStart` | `() => string` | Removes the leading white space and line terminator characters from a string. |
| `trimLeft` | `() => string` | Removes the leading white space and line terminator characters from a string. |
| `trimRight` | `() => string` | Removes the trailing white space and line terminator characters from a string. |
| `matchAll` | `(regexp: RegExp) => RegExpStringIterator<RegExpExecArray>` | Matches a string with a regular expression, and returns an iterable of matches containing the results of that search. |
| `replaceAll` | `{ (searchValue: string \| RegExp, replaceValue: string): string; (searchValue: string \| RegExp, replacer: (substring: string, ...args: any[]) => string): string; }` | Replace all instances of a substring in a string, using a regular expression or search string. |
| `at` | `(index: number) => string \| undefined` | Returns a new String consisting of the single UTF-16 code unit located at the specified index. |
| `__@iterator@55` | `() => StringIterator<string>` | Iterator |
