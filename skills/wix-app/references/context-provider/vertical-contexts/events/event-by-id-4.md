# Events context: `@wix/events/context/event-by-id` (part 4 of 6)

This context's reference is split across 6 files: [event-by-id.md](event-by-id.md), [event-by-id-2.md](event-by-id-2.md), [event-by-id-3.md](event-by-id-3.md), [event-by-id-4.md](event-by-id-4.md), [event-by-id-5.md](event-by-id-5.md), [event-by-id-6.md](event-by-id-6.md).

Read [Importing a Context in Code](../../CONSUMING.md#importing-a-context-in-code) first. Import only the hook, from `@wix/events/context/event-by-id`.

##### `i18n`

| Property | Type | Description |
| --- | --- | --- |
| `t` | `TFunction<["translation", ...string[]], undefined>` |  |
| `init` | `{ (callback?: Callback \| undefined): Promise<TFunction<"translation", undefined>>; <T>(options: InitOptions<T>, callback?: Callback \| undefined): Promise<TFunction<"translation", undefined>>; }` | The default of the i18next module is an i18next instance ready to be initialized by calling init. You can create additional instances using the createInstance function. |
| `loadResources` | `(callback?: ((err: any) => void) \| undefined) => void` |  |
| `use` | `<T extends Module>(module: T \| NewableModule<T> \| Newable<T>) => i18n` | The use function is there to load additional plugins to i18next. For available module see the plugins page and don't forget to read the documentation of the plugin. |
| `modules` | `Modules` | List of modules used |
| `services` | `Services` | Internal container for all used plugins and implementation details like languageUtils, pluralResolvers, etc. |
| `store` | `ResourceStore` | Internal container for translation resources |
| `exists` | `{ <K extends string>(key: K, options?: TOptions<$Dictionary<unknown>> \| undefined): key is K & string & { readonly [$SelectorKeyBrand]: typeof $SelectorKeyBrand; }; (key: string \| string[], options?: TOptions<$Dictionary<unknown>> \| undefined): boolean; }` | Uses similar args as the t function and returns true if a key exists. Acts as a type guard on single-key calls, narrowing the key to {@link SelectorKey} so it can be passed to `t()`. |
| `getDataByLanguage` | `(lng: string) => { [key: string]: { [key: string]: string; }; } \| undefined` | Returns a resource data by language. |
| `getFixedT` | `{ <Ns extends Namespace \| null, const TKPrefixFn extends (TypeOptions["enableSelector"] extends true \| "optimize" \| "strict" ? KeyPrefixSelector<ActualNs> : never), ActualNs extends Namespace = Ns extends null ? "translation" : Ns>(lng: string \| readonly string[] \| null, ns: Ns, keyPrefix: TKPrefixFn): TFunction<ActualNs, TKPrefixFn>; <Ns extends Namespace \| null = "translation", TKPrefix extends KeyPrefix<ActualNs> = undefined, ActualNs extends Namespace = Ns extends null ? "translation" : Ns>(...args: [lng: string \| readonly string[], ns?: Ns \| undefined, keyPrefix?: TKPrefix \| (($: any) => any) \| undefined] \| [lng: null, ns: Ns, keyPrefix?: TKPrefix \| (($: any) => any) \| undefined]): TFunction<ActualNs, TKPrefix>; }` | Returns a t function that defaults to given language or namespace. Both params could be arrays of languages or namespaces and will be treated as fallbacks in that case. On the returned function you can like in the t function override the languages or namespaces by passing them in options or by prepending namespace. Accepts optional keyPrefix that will be automatically applied to returned t function. |
| `changeLanguage` | `(lng?: string \| undefined, callback?: Callback \| undefined) => Promise<TFunction<"translation", undefined>>` | Changes the language. The callback will be called as soon translations were loaded or an error occurs while loading. HINT: For easy testing - setting lng to 'cimode' will set t function to always return the key. |
| `language` | `string` | Is set to the current detected or set language. If you need the primary used language depending on your configuration (supportedLngs, load) you will prefer using i18next.languages[0]. |
| `languages` | `readonly string[]` | Is set to an array of language-codes that will be used it order to lookup the translation value. |
| `resolvedLanguage` | `string \| undefined` | Is set to the current resolved language. It can be used as primary used language, for example in a language switcher. |
| `hasLoadedNamespace` | `(ns: string \| readonly string[], options?: { lng?: string \| readonly string[] \| undefined; fallbackLng?: false \| FallbackLng \| undefined; precheck?: ((i18n: i18n$1, loadNotPending: (lng: string \| readonly string[], ns: string \| readonly string[]) => boolean) => boolean \| undefined) \| undefined; } \| undefined) => boolean` | Checks if namespace has loaded yet. i.e. used by react-i18next |
| `loadNamespaces` | `(ns: string \| readonly string[], callback?: Callback \| undefined) => Promise<void>` | Loads additional namespaces not defined in init options. |
| `loadLanguages` | `(lngs: string \| readonly string[], callback?: Callback \| undefined) => Promise<void>` | Loads additional languages not defined in init options (preload). |
| `reloadResources` | `{ (lngs?: string \| readonly string[] \| undefined, ns?: string \| readonly string[] \| undefined, callback?: (() => void) \| undefined): Promise<void>; (lngs: null, ns: string \| readonly string[], callback?: (() => void) \| undefined): Promise<void>; }` | Reloads resources on given state. Optionally you can pass an array of languages and namespaces as params if you don't want to reload all. |
| `setDefaultNamespace` | `(ns: string \| readonly string[]) => void` | Changes the default namespace. |
| `dir` | `(lng?: string \| undefined) => "ltr" \| "rtl"` | Returns rtl or ltr depending on languages read direction. |
| `format` | `FormatFunction` | Exposes interpolation.format function added on init. |
| `createInstance` | `(options?: InitOptions<object> \| undefined, callback?: Callback \| undefined) => i18n$1` | Will return a new i18next instance. Please read the options page for details on configuration options. Providing a callback will automatically call init. The callback will be called after all translations were loaded or with an error when failed (in case of using a backend). |
| `cloneInstance` | `(options?: CloneOptions \| undefined, callback?: Callback \| undefined) => i18n$1` | Creates a clone of the current instance. Shares store, plugins and initial configuration. Can be used to create an instance sharing storage but being independent on set language or namespaces. |
| `toJSON` | `() => { options: InitOptions<object>; store: ResourceStore; language: string; languages: readonly string[]; resolvedLanguage?: string \| undefined; }` | Returns a JSON representation of the i18next instance for serialization. |
| `on` | `{ (event: "initialized", callback: (options: InitOptions<object>) => void): i18n; (event: "loaded", callback: (loaded: { [language: string]: { [namespace: string]: boolean; }; }) => void): i18n; (event: "failedLoading", callback: (lng: string, ns: string, msg: string) => void): i18n; (event: "missingKey", callback: (lngs: readonly string[], namespace: string, key: string, res: string) => void): i18n; (event: "languageChanged", callback: (lng: string) => void): i18n; (event: string, listener: (...args: any[]) => void): i18n; }` | Gets fired after initialization. Gets fired on loaded resources. Gets fired if loading resources failed. Gets fired on accessing a key not existing. Gets fired when changeLanguage got called. Event listener |
| `off` | `(event: string, listener?: ((...args: any[]) => void) \| undefined) => void` | Remove event listener removes all callback when callback not specified |
| `once` | `(event: string, listener: (...args: any[]) => void) => i18n` | Subscribe to an event, but only once. The listener is removed after the first call. |
| `getResource` | `(lng: string, ns: string, key: string, options?: Pick<InitOptions<object>, "keySeparator" \| "ignoreJSONStructure"> \| undefined) => any` | Gets one value by given key. |
| `addResource` | `(lng: string, ns: string, key: string, value: string, options?: { keySeparator?: string \| undefined; silent?: boolean \| undefined; } \| undefined) => i18n$1` | Adds one key/value. |
| `addResources` | `(lng: string, ns: string, resources: any) => i18n$1` | Adds multiple key/values. |
| `addResourceBundle` | `(lng: string, ns: string, resources: any, deep?: boolean \| undefined, overwrite?: boolean \| undefined, options?: { silent?: boolean \| undefined; skipCopy?: boolean \| undefined; } \| undefined) => i18n$1` | Adds a complete bundle. Setting deep param to true will extend existing translations in that file. Setting overwrite to true it will overwrite existing translations in that file. |
| `hasResourceBundle` | `(lng: string, ns: string) => boolean` | Checks if a resource bundle exists. |
| `getResourceBundle` | `(lng: string, ns: string) => any` | Returns a resource bundle. |
| `removeResourceBundle` | `(lng: string, ns: string) => i18n$1` | Removes an existing bundle. |
| `options` | `InitOptions<object>` | Current options |
| `isInitialized` | `boolean` | Is initialized |
| `isInitializing` | `boolean` | Is initializing |
| `initializedStoreOnce` | `boolean` | Store was initialized |
| `initializedLanguageOnce` | `boolean` | Language was initialized |
| `emit` | `(eventName: string, ...args: any[]) => void` | Emit event |
