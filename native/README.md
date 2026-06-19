# notes — React Native app

A React Native (Expo) front-end for **notes**, sharing the entire
platform-agnostic core with the web PWA. This is a separate Expo project that
lives alongside the web app; today it runs in Expo Go and the simulators, and
[`RELEASING.md`](RELEASING.md) is the step-by-step for building and submitting
it to the App Store and Google Play via EAS.

## How it reuses the web app

The web app's architecture (see [`../CLAUDE.md`](../CLAUDE.md)) keeps a clean
split between platform-agnostic logic and the DOM presentation layer. The
native app imports the logic verbatim from `../src` and supplies its own
React Native views in `native/src/`:

| Layer | Source | Shared with web? |
|---|---|---|
| Note model + pure operations | `../src/domain/note.ts` | ✅ verbatim |
| App state, edits, undo/redo, persistence engine | `../src/app/use-notes*.ts`, `use-undo-redo.ts` | ✅ verbatim |
| Storage contract, serialize, migrations, namespaces | `../src/storage/{adapter,serialize,migrations,namespaces}.ts` | ✅ verbatim |
| **Local storage backend** | `native/src/storage/asyncStorageAdapter.ts` | ⛔ native (AsyncStorage) |
| **iCloud storage backend (iOS only)** | `native/src/storage/icloudStorageAdapter.ts` | ⛔ native (iCloud KVS) |
| **Presentation** | `native/src/components/`, `native/src/App.tsx` | ⛔ native (`View`/`Text`/…) |
| **Theme tokens** | `native/src/theme.ts` | ⛔ native (no CSS variables) |

The shared core required **no refactoring** to be consumed here: every web
global it touches (`localStorage`, `navigator`) is already behind a `typeof
… === "undefined"` guard, so on React Native it transparently falls back
(single default namespace, empty `loadSync`). The only runtime shim is a
`crypto.randomUUID` polyfill — see `native/src/polyfills.ts`.

The `AsyncStorageAdapter` implements the same `StorageAdapter` contract as the
web's `BrowserLocalStorageAdapter`, so `useNotes` drives it unchanged. It does
not advertise the synchronous `loadSync` capability (AsyncStorage has no sync
read); `useNotesSync` already tolerates that by seeding empty and loading in
its mount effect.

## iCloud backend (iOS only)

On iOS the app offers a second backend, **iCloud**
(`native/src/storage/icloudStorageAdapter.ts`), which stores the document in
Apple's iCloud key-value store (`NSUbiquitousKeyValueStore`, via
`react-native-icloudstore`) so it syncs across the signed-in user's devices
with no accounts, OAuth, or network code of our own. It implements the same
`StorageAdapter` contract as the on-device backend and advertises the `watch`
capability — when another device pushes an edit, iCloud fires a change event,
the adapter re-reads its key, and `App.tsx` calls `reload()` so the new state
appears live.

The backend is **only exposed on iOS**: `native/src/storage/backends.ts` is
the single platform gate — `availableBackends()` appends iCloud only when
`Platform.OS === "ios"`, and the iCloud adapter module (which pulls the
iOS-only native dependency) is required lazily so it never loads on Android or
web. The choice is persisted per device in AsyncStorage
(`backendPreference.ts`) and surfaced as a **Storage** picker in the menu
sheet, which renders only when more than one backend is available — i.e. only
on iOS. The on-device default is unchanged everywhere.

> iCloud key-value sync needs the
> `com.apple.developer.ubiquity-kvstore-identifier` entitlement (declared in
> `app.json` under `ios.entitlements`) and a native build — it is inert in
> Expo Go, which can't load the custom native module. Selecting it there
> simply falls back to "no data" reads until the app runs as a dev/standalone
> build signed with the entitlement.

## What's implemented

The core note-taking flows, all backed by the shared hook:

- Browse the note list (newest-edited first; each row shows the title — the
  first non-empty line — over a one-line preview), tap to open.
- Write a new note from the floating **+** button; abandoned, never-typed
  notes drop themselves the same way the web app discards them.
- Edit a note in a full-screen text editor; every keystroke persists through
  the shared `update` verb (a run of edits coalesces into one undo step).
- Delete a note from the editor's header.
- Undo / Redo across the whole-document timeline, from the menu sheet.
- On iOS, switch the active note store between **This device** and **iCloud**.

### Not yet ported (web-only for now)

The live Markdown-preview editor (the native editor is a plain text field for
now), cloud backends (Dropbox / Google Drive), at-rest encryption + unlock
gate, the full theme engine (presets / custom colours / fonts), namespaces,
settings UI, achievements, and the changelog modal. These layers are either
DOM/CSS-bound or depend on browser-only APIs; they can grow into `native/`
incrementally without touching the shared core.

## Running it

> Requires the native app's own dependencies. From this directory:

```sh
cd native
npm install          # or: npx expo install (to align versions with the SDK)
npx expo start       # then press i / a, or scan the QR with Expo Go
```

Metro is configured (`metro.config.js`) to watch the repo root so the
shared modules in `../src` are transformed and hot-reloaded as part of the
app. `react` and `react-native` are pinned to this app's `node_modules` so
the shared hooks bind to the same React instance the renderer uses.

Type-check the native app (includes the shared core it imports):

```sh
npm run typecheck
```
