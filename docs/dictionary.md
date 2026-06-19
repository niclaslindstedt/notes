# Dictionary

Maps the words the user (and the team) say in plain English to the concrete
components, types, and files in this codebase. **This file is the index**:
each row resolves a term to the most specific file and the symbols to grep
for, and stops there.

**The explanation for every term lives in [`docs/overview.md`](overview.md)**
— same headings, one-to-one. Look a word up here to find the code; read the
same word in the overview to understand how it behaves and what it touches.
Deep module layout and persisted-shape mechanics live in
[`docs/architecture.md`](architecture.md); the codified rules live in
[`AGENTS.md`](../AGENTS.md).

**When an agent encounters a term in user instructions that is not a literal
filename or import path**, look it up here first to resolve it to the right
code surface before searching. **When a new feature ships or the user
introduces a new word**, add a row here AND a matching `overview.md` entry —
same pull request, alongside the code change — so the next agent doesn't have
to guess.

The `[→]` link in each row points at the term's full description in
`overview.md`.

## Canonical vocabulary

One verb / noun per concept across components, i18n strings, and file names.
Honour these when naming a new file, key, or string.

| Concept                          | Canonical                                            | Retire                                          |
| -------------------------------- | ---------------------------------------------------- | ----------------------------------------------- |
| A single written note            | **note** (`Note`)                                    | "doc", "page", "entry" in code                  |
| The whole persisted document     | **snapshot** (`Snapshot`)                            | "document" in type names, "state"               |
| Hide a note without destroying   | **archive** (`setArchived`, `archived`)              | "trash", "remove" for the non-destructive case  |
| Destroy a note                   | **delete** / **remove** (`remove`)                   | "trash" in code                                 |
| Persist to a backend             | **save** (`save`, `saveNow`, `scheduleSave`)         | "sync" for the act of writing one document      |
| Re-read from the backend         | **reload** / **refresh** / **pull to refresh** (UI)  | "fetch" in code                                 |
| A persistence backend            | **backend** / **adapter** (`StorageAdapter`)         | "provider" except for the cloud vendor name     |
| The local backend (UI label)     | **This device**                                      | "browser", "localStorage" in UI copy            |
| The folder backend (UI label)    | **Local folder** (`folder`)                          | "directory", "disk"                             |
| A named bucket of notes          | **namespace** (`Namespace`, `slug`)                  | "workspace", "vault"                            |
| On-disk per-note file            | **markdown file** (`storage/markdown/codec.ts`)      | "export" — it's the live store, not an export   |
| The synced appearance record     | **appearance** (`Appearance`)                        | "settings" for the theme/font/editor record     |
| Overlay with backdrop            | `*Modal.tsx`                                          | `*Dialog.tsx`, `*Popover.tsx`                   |
| A standalone crawlable route     | `*Page.tsx` (`HomePage`, `PrivacyPage`)              | `*View.tsx` (notes uses inline views in `App`)  |

## Top-level UI and shell

| Term                                                       | Refers to                                                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **App shell** / **root** / **the main layout**             | `App` (`src/app/App.tsx`). [→](overview.md#app-shell)                                                       |
| **Entry point** / **startup** / **path switch**            | `src/app/main.tsx`. [→](overview.md#entry-point--path-switch)                                                |
| **Note list** / **the overview** / **the list** / **main screen** | `NoteList` in `src/app/App.tsx`; visible set from `notes` (`useNotes`). [→](overview.md#note-list--overview) |
| **Note card** / **the card**                               | `NoteCard` / `SwipeableNoteCard` in `src/app/App.tsx`. [→](overview.md#note-card)                            |
| **Archive view** / **the archive**                         | `ArchiveList` / `ReadOnlyNote` in `src/app/App.tsx`; `view === "archive"`. [→](overview.md#archive-view)     |
| **Header** / **the top bar**                               | header markup in `src/app/App.tsx` (app title, sync glyph, trophy button). [→](overview.md#app-shell)        |
| **App title** / **wordmark**                               | `AppTitle` (`src/ui/AppTitle.tsx`). [→](overview.md#app-title)                                               |
| **Drop overlay** / **drag-and-drop import**                | `DropOverlay` (`src/ui/DropOverlay.tsx`); `useFileDrop` (`src/ui/hooks/useFileDrop.ts`); `importedNote` (`src/domain/import.ts`). [→](overview.md#drag-and-drop-import) |
| **Update toast** / **"new build ready"** / **reload prompt** | `UpdateToast` (`src/ui/UpdateToast.tsx`); `usePwaUpdate` (`src/pwa/usePwaUpdate.ts`). [→](overview.md#update-toast) |
| **Icons** / **glyph** (generic UI icon)                    | `src/ui/icons.tsx`. [→](overview.md#icons)                                                                   |
| **Button** (primitive)                                     | `Button` (`src/ui/form/Button.tsx`). [→](overview.md#button)                                                 |
| **Checkbox** / **toggle** (primitive)                      | `Checkbox` (`src/ui/form/Checkbox.tsx`). [→](overview.md#checkbox)                                            |

## The editor

| Term                                                       | Refers to                                                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Editor** / **live-preview editor** / **note body editor** | `MarkdownEditor` (`src/ui/MarkdownEditor.tsx`). [→](overview.md#markdown-editor)                            |
| **Rendered line** / **formatted line** / **live preview**  | `RenderedLine` (`src/ui/MarkdownLine.tsx`); `markdownLineClass` (`src/ui/markdown-line-class.ts`). [→](overview.md#rendered-line) |
| **Markdown parser** / **classify lines** / **inline formatting** | `classifyLines`, `parseInline`, `LineBlock`, `InlineNode` (`src/domain/markdown.ts`). [→](overview.md#markdown-parser) |
| **Image attachment** / **paste an image** / **drop an image** / **thumbnail** / **attachments folder** | `Attachment` (`src/domain/attachment.ts`); `AttachmentsProvider`, `InlineImage`, `ImageViewer`, `useThumbnail` (`src/ui/attachments/`); `AttachmentStore` (`src/storage/attachment-store.ts`); `attach` (`src/app/use-notes.ts`). [→](overview.md#image-attachments) |
| **Title field** / **rename a note** / **the note title**   | `TitleField` in `src/app/App.tsx`; `retitleNote` (`src/domain/note.ts`). [→](overview.md#title-field)        |
| **Editor margin** / **writing column width** / **word wrap** / **spell-check toggle** | `EditorSettings`, `EditorMargin`, `editorMarginMaxWidth` (`src/theme/themes.ts`); `EditorSection` (`src/ui/settings/EditorSection.tsx`). [→](overview.md#editor-settings) |
| **Copy button** / **copy glyph** / **copy note** / **copy scope** / **copy with front matter** | `CopyNoteButton` (`src/ui/CopyNoteButton.tsx`); `buildCopyText` (`src/ui/copy-note.ts`); `CopyScope` (`src/domain/note.ts`). [→](overview.md#copy-button) |

## The note model and operations

| Term                                                       | Refers to                                                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Note** / **a note record**                               | `Note` (`src/domain/note.ts`). [→](overview.md#note)                                                         |
| **Snapshot** / **the document**                            | `Snapshot` (`src/domain/note.ts`). [→](overview.md#snapshot)                                                 |
| **Create a note** / **new note**                           | `createNote` (`src/domain/note.ts`); `create` (`src/app/use-notes.ts`); `openNew` (`src/app/App.tsx`). [→](overview.md#create-a-note) |
| **Edit a note** / **change the body**                      | `editNote` (`src/domain/note.ts`); `update` (`src/app/use-notes.ts`). [→](overview.md#edit-a-note)           |
| **Retitle** / **rename**                                   | `retitleNote` (`src/domain/note.ts`); `retitle` (`src/app/use-notes.ts`). [→](overview.md#retitle)           |
| **Archive** / **restore**                                  | `setArchived`, `activeNotes`, `archivedNotes` (`src/domain/note.ts`); `archive` / `restore` (`src/app/use-notes.ts`). [→](overview.md#archive--restore) |
| **Delete** / **remove a note**                             | `remove` (`src/app/use-notes.ts`). [→](overview.md#delete)                                                   |
| **Blank note** / **discard an empty note** / **pristine note** | `isBlank` (`src/domain/note.ts`); `discardable` / `pristineNew` (`src/app/App.tsx`). [→](overview.md#blank-note) |
| **Note title fallback** / **default title** / **auto-naming** | `noteTitle`, `defaultNoteTitle`, `DefaultTitleScheme` (`src/domain/note.ts`). [→](overview.md#default-title) |
| **Preview** / **list excerpt**                             | `notePreview` (`src/domain/note.ts`). [→](overview.md#preview)                                               |
| **Sort newest-edited** / **list order**                    | `sortByUpdated` (`src/domain/note.ts`). [→](overview.md#sort-order)                                          |
| **Import files** / **dropped markdown**                    | `importedNote`, `isImportableFilename`, `titleFromFilename` (`src/domain/import.ts`); `importFiles` (`src/app/use-notes.ts`). [→](overview.md#import-files) |

## App state and orchestration

| Term                                                       | Refers to                                                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Notes store** / **app state** / **the store hook**       | `useNotes`, `NotesStore` (`src/app/use-notes.ts`). [→](overview.md#notes-store)                              |
| **Sync engine** / **save status** / **debounced save**     | `useNotesSync`, `NotesSync`, `SaveStatus` (`src/app/use-notes-sync.ts`). [→](overview.md#sync-engine)        |
| **Live pull** / **live sync** / **watch another device**    | `LIVE_PULL_INTERVAL_MS`, `shouldLivePull`, the polling effect in `useNotesSync` (`src/app/use-notes-sync.ts`); the body-reconcile effect in `MarkdownEditor`/`PlainEditor`. [→](overview.md#live-pull) |
| **Save hold** / **defer save while titling**               | `holdSaves` / `releaseSaves` (`src/app/use-notes-sync.ts`). [→](overview.md#save-hold)                       |
| **Undo** / **redo** / **undo timeline** / **history**      | `useUndoRedo`, `UndoRedo`, `UNDO_HISTORY_LIMIT` (`src/app/use-undo-redo.ts`); `useUndoRedoShortcuts` (`src/ui/hooks/useUndoRedoShortcuts.ts`). [→](overview.md#undo--redo) |
| **Settings sync** / **theme travels with the folder**      | `useSettingsSync` (`src/app/use-settings-sync.ts`); `SettingsStore` (`src/storage/settings-store.ts`). [→](overview.md#settings-sync) |
| **Nav state** / **drawer open state**                      | `useNavState`, `NavContextValue` (`src/app/use-nav.ts`, `src/ui/nav-context.ts`). [→](overview.md#nav-state) |

## Navigation, drawer, and gestures

| Term                                                       | Refers to                                                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Side menu** / **drawer** / **nav** / **sidebar**         | `SideMenu` (`src/ui/SideMenu.tsx`); `NavContext`, `useNav` (`src/ui/nav-context.ts`). [→](overview.md#side-menu) |
| **Floating menu button** / **drag button** / **hamburger** | `useDraggableMenuButton` (`src/ui/hooks/useDraggableMenuButton.ts`); `src/ui/sideMenuPosition.ts`; `showButton` in `nav-context.ts`. [→](overview.md#floating-menu-button) |
| **Edge swipe to open** / **swipe in from the edge**        | `useEdgeSwipeOpen` (`src/ui/hooks/useEdgeSwipeOpen.ts`). [→](overview.md#edge-swipe-to-open)                  |
| **Swipe the drawer closed** / **drag to close**            | `useDrawerSwipeClose` (`src/ui/hooks/useDrawerSwipeClose.ts`). [→](overview.md#drawer-swipe-to-close)         |
| **Swipe to archive** / **swipe to delete** (note card)     | `useRowSwipe` (`src/ui/hooks/useRowSwipe.ts`). [→](overview.md#row-swipe)                                     |
| **Swipe to remove** (sidebar row)                          | `useSwipeReveal` (`src/ui/hooks/useSwipeReveal.ts`). [→](overview.md#swipe-reveal-sidebar)                    |
| **Pull to refresh** / **pull down to sync**                | `usePullToRefresh` (`src/ui/hooks/usePullToRefresh.ts`); `PullToRefreshIndicator` (`src/ui/PullToRefreshIndicator.tsx`). [→](overview.md#pull-to-refresh) |
| **Pinned sidebar** / **docked on tablet** / **media query** | `pinned` in `nav-context.ts`; `useMediaQuery` (`src/ui/hooks/useMediaQuery.ts`). [→](overview.md#pinned-sidebar) |
| **Viewport height** / **soft-keyboard height**             | `useViewportHeight` (`src/ui/hooks/useViewportHeight.ts`); `appViewportRect` (`src/ui/appViewportRect.ts`). [→](overview.md#viewport-height) |

## Modals and dialogs

| Term                                                       | Refers to                                                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Modal** (base component)                                 | `Modal` (`src/ui/Modal.tsx`). [→](overview.md#modal)                                                         |
| **Modal bus** / **open a dialog from anywhere**            | `modal-bus.ts`, `ModalBusProvider`, `useModalState`, `useModalDispatch` (`src/ui/`). [→](overview.md#modal-bus) |
| **Modal host** (settings/namespaces/changelog/achievements) | `src/app/modals/*Host.tsx`. [→](overview.md#modal-hosts)                                                     |
| **Settings modal** / **preferences**                       | `SettingsModal` (`src/ui/settings/SettingsModal.tsx`). [→](overview.md#settings-modal)                       |
| **Namespaces modal** / **manage namespaces**               | `NamespacesModal` (`src/ui/NamespacesModal.tsx`). [→](overview.md#namespaces-modal)                          |
| **Changelog modal** / **what's new**                       | `ChangelogModal` (`src/ui/changelog/ChangelogModal.tsx`). [→](overview.md#changelog-modal)                   |
| **Achievements modal** / **trophy tour**                   | `AchievementsModal` (`src/ui/achievements/AchievementsModal.tsx`). [→](overview.md#achievements-modal)        |
| **Unlock modal** / **achievement notification**            | `AchievementUnlockModal` (`src/ui/achievements/AchievementUnlockModal.tsx`). [→](overview.md#unlock-modal)    |
| **Sync details modal** / **what went wrong with sync**     | `SyncDetailsModal` (`src/ui/SyncDetailsModal.tsx`). [→](overview.md#sync-details-modal)                       |
| **Conflict modal** / **another device edited** / **keep mine** | `ConflictModal` (`src/ui/ConflictModal.tsx`). [→](overview.md#conflict-modal)                                 |
| **Unlock gate** / **passphrase prompt**                    | `UnlockGate` (`src/ui/UnlockGate.tsx`). [→](overview.md#unlock-gate)                                          |

## Settings tabs

| Term                                                       | Refers to                                                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **General settings** / **language / achievements toggle**  | `GeneralSection` (`src/ui/settings/GeneralSection.tsx`). [→](overview.md#general-settings)                    |
| **Appearance settings** / **theme picker / font / density** | `AppearanceSection` (`src/ui/settings/AppearanceSection.tsx`); `ColorPalette` (`src/ui/ColorPalette.tsx`). [→](overview.md#appearance-settings) |
| **Editor settings** / **margin / word-wrap / spell-check** | `EditorSection` (`src/ui/settings/EditorSection.tsx`). [→](overview.md#editor-settings)                       |
| **Storage settings** / **pick a backend / encryption**     | `StorageSection` (`src/ui/settings/StorageSection.tsx`). [→](overview.md#storage-settings)                    |
| **Developer settings** / **dev mode**                      | `DeveloperSection` (`src/ui/settings/DeveloperSection.tsx`); `useDevMode` (`src/dev/useDevMode.ts`). [→](overview.md#developer-settings) |
| **Logs tab** / **captured logs**                           | `LogsSection` (`src/ui/settings/LogsSection.tsx`); `logger` (`src/dev/logger.ts`). [→](overview.md#logs)      |
| **Language picker** / **switch language**                  | `LanguagePicker` (`src/ui/settings/LanguagePicker.tsx`). [→](overview.md#language-picker)                     |
| **Settings layout helpers** (Section / Field / ToggleRow)  | `src/ui/settings/shared.tsx`. [→](overview.md#settings-layout-helpers)                                        |

## Sync and storage status (header)

| Term                                                       | Refers to                                                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Sync glyph** / **cloud icon** / **save status button**   | `SyncStatus` (`src/ui/SyncStatus.tsx`). [→](overview.md#sync-status)                                          |
| **Sync indicator** (the glyph itself)                      | `SyncIndicator` (`src/ui/SyncIndicator.tsx`). [→](overview.md#sync-indicator)                                 |

## Storage backends and persistence

| Term                                                       | Refers to                                                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Storage adapter** / **the byte contract**                | `StorageAdapter`, `StoredSnapshot`, `ConflictError`, `AuthError`, `RateLimitError` (`src/storage/adapter.ts`). [→](overview.md#storage-adapter) |
| **Storage backend hook** / **wire the active backend**     | `useStorageBackend`, `UseStorageBackend` (`src/storage/useStorageBackend.ts`). [→](overview.md#storage-backend-hook) |
| **Backend preference** / **which backend / tokens**        | `backend-preference.ts`, `BackendId` (`src/storage/`). [→](overview.md#backend-preference)                    |
| **Serialize / parse** / **the load-save pipeline**         | `serialize`, `parse` (`src/storage/serialize.ts`). [→](overview.md#serialize--parse)                          |
| **Migrations** / **document version**                      | `migrate`, `LATEST_VERSION` (`src/storage/migrations.ts`). [→](overview.md#migrations)                        |
| **This device backend** / **local storage**                | `BrowserLocalStorageAdapter` (`src/storage/local/index.ts`). [→](overview.md#local-backend)                  |
| **Local folder backend** / **connect a folder** / **File System Access** | `createFolderAdapter`, `FolderFileStore` (`src/storage/folder/index.ts`); `handle-store.ts`. [→](overview.md#folder-backend) |
| **Dropbox backend**                                        | `createDropboxAdapter`, `DROPBOX_APP_FOLDER` (`src/storage/dropbox/index.ts`). [→](overview.md#dropbox-backend) |
| **Google Drive backend**                                   | `createGdriveAdapter`, `GDRIVE_SCOPE` (`src/storage/gdrive/index.ts`). [→](overview.md#google-drive-backend)        |
| **Directory adapter** / **one-file-per-note sync**         | `createDirectoryAdapter` (`src/storage/directory-adapter.ts`); `FileStore` (`src/storage/file-store.ts`). [→](overview.md#directory-adapter) |
| **Markdown codec** / **note ↔ file**                       | `snapshotToFiles`, `filesToSnapshot`, `noteToMarkdown`, `parseNote` (`src/storage/markdown/codec.ts`). [→](overview.md#markdown-codec) |
| **Save retry** / **backoff**                               | `backoffDelayMs`, `isRetryableSaveError`, `MAX_TRANSIENT_SAVE_RETRIES` (`src/storage/save-retry.ts`); `http-utils.ts`. [→](overview.md#save-retry) |
| **OAuth** / **PKCE** / **connect an account**              | `oauth-pkce.ts` (`startAuth`, `completeAuth`, `refreshAccessToken`); `base64url.ts` (`src/encoding/`). [→](overview.md#oauth) |

## Encryption and offline

| Term                                                       | Refers to                                                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Encryption at rest** / **password-protect** / **lock**   | `withEncryption`, `PasswordRef` (`src/storage/encrypting/index.ts`); `encryptText`, `decryptEnvelope` (`src/storage/crypto.ts`). [→](overview.md#encryption) |
| **Offline cache** / **local mirror** / **work offline**    | `withLocalCache`, `isOfflineError`, `OfflineUnavailableError` (`src/storage/cache/index.ts`). [→](overview.md#offline-cache) |

## Namespaces

| Term                                                       | Refers to                                                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Namespace** / **bucket of notes** / **switch namespace** | `Namespace`, `addNamespace`, `setActiveNamespaceSlug`, `slugify` (`src/storage/namespaces.ts`). [→](overview.md#namespaces) |
| **Namespace registry store** / **`namespaces.json`**       | `NamespaceRegistryStore`, `fileNamespaceStore` (`src/storage/namespace-store.ts`). [→](overview.md#namespace-registry-store) |
| **Namespace glyph** / **namespace icon**                   | `NamespaceGlyph` (`src/ui/NamespaceGlyph.tsx`); glyph catalog (`src/ui/glyphs.ts`, `GlyphGrid`). [→](overview.md#namespace-glyph) |
| **Namespace color**                                        | `src/ui/namespace-colors.ts`. [→](overview.md#namespace-color)                                               |
| **Namespace favicon** / **per-namespace tab icon**         | `src/ui/namespace-favicon.ts`. [→](overview.md#namespace-favicon)                                            |

## Theme and appearance

| Term                                                       | Refers to                                                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Appearance store** / **theme/font/editor settings**      | `Appearance`, `useAppearance`, `updateAppearance`, `getAppearance` (`src/theme/useTheme.ts`). [→](overview.md#appearance-store) |
| **Theme preset** / **light / dark / Dracula / system**     | `ThemePreset`, `THEMES`, `themeFamily` (`src/theme/themes.ts`). [→](overview.md#theme-preset)                |
| **Custom theme** / **color editor** / **color slots**      | `CustomTheme`, `CustomThemeColors`, `COLOR_KEYS`, `PRESET_PALETTES` (`src/theme/themes.ts`); `ColorPalette` (`src/ui/ColorPalette.tsx`). [→](overview.md#custom-theme) |
| **Font family** / **font scale** / **text size**           | `FontFamilyId`, `FONT_FAMILIES`, `FONT_SCALE_PRESETS` (`src/theme/themes.ts`); `loadFontFamily` (`src/theme/fonts.ts`). [→](overview.md#fonts) |
| **Density** / **corner radius**                            | `DensityPreset`, `RadiusPreset` (`src/theme/themes.ts`). [→](overview.md#density--radius)                     |
| **Design tokens** / **CSS variables** / **palettes**       | `src/styles/theme.css`, `src/styles/palettes.css`, `src/styles.css`; `COLOR_KEY_TO_CSS_VAR`. [→](overview.md#design-tokens) |

## Achievements

| Term                                                       | Refers to                                                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Achievement** / **trophy** / **unlockable**              | `Achievement`, `AchievementTier`, `ACHIEVEMENTS` (`src/achievements/catalog.ts`, `types.ts`). [→](overview.md#achievement-catalog) |
| **Trophy button** / **achievements badge**                 | `TrophyButton` (`src/ui/achievements/TrophyButton.tsx`). [→](overview.md#trophy-button)                       |
| **Derived unlock** / **manual unlock** / **the unlock bus** | `deriveUnlocks` (`src/achievements/derive.ts`); `unlock`, `subscribe`, `drain` (`src/achievements/bus.ts`); `useAchievementWatcher` (`src/achievements/useAchievementWatcher.ts`). [→](overview.md#unlock-triggers) |
| **Achievement glyphs**                                     | `src/achievements/glyphs.tsx`. [→](overview.md#achievement-glyphs)                                            |

## Changelog / What's new

| Term                                                       | Refers to                                                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Changelog data** / **parsed CHANGELOG**                  | `src/ui/changelog/data.ts`, `parse.ts`. [→](overview.md#changelog-data)                                      |
| **Feature docs** / **"Learn more"**                        | `feature-docs.ts` (`src/ui/changelog/`); `docs/features/<slug>.md`. [→](overview.md#feature-docs)            |
| **Changelog renderer**                                     | `render.tsx` (`src/ui/changelog/`). [→](overview.md#changelog-renderer)                                      |

## Internationalization

| Term                                                       | Refers to                                                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **i18n runtime** / **`t()`** / **translation lookup**      | `useT`, `tFor`, `MessageKey`, `Catalog` (`src/i18n/index.ts`). [→](overview.md#i18n-runtime)                 |
| **Language root** / **first-paint language gate**          | `LanguageRoot` (`src/i18n/LanguageRoot.tsx`); `readLanguagePreference` (`src/i18n/language-preference.ts`). [→](overview.md#language-root) |
| **Locale helpers** / **detect language**                   | `Lang`, `SUPPORTED_LANGS`, `bcp47`, `detectInitialLanguage` (`src/i18n/locale.ts`). [→](overview.md#locale-helpers) |
| **Catalog namespaces** (`app`, `menu`, `sync`, …)          | `src/i18n/locales/{en,sv}/<ns>.ts`. [→](overview.md#catalog-namespaces)                                       |

## PWA, dev, and build

| Term                                                       | Refers to                                                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **PWA update** / **service worker** / **download progress** | `usePwaUpdate`, `PwaUpdateState` (`src/pwa/usePwaUpdate.ts`). [→](overview.md#pwa-update)                     |
| **Standalone / installed PWA detection**                   | `isStandaloneMobile`, `useStandaloneMobile` (`src/pwa/standalone.ts`). [→](overview.md#standalone-detection)  |
| **Dev mode** / **capture logs**                            | `useDevMode` (`src/dev/useDevMode.ts`). [→](overview.md#dev-mode)                                             |
| **Logger** / **log buffer**                                | `createLogger`, `getLogs`, `setCaptureEnabled` (`src/dev/logger.ts`). [→](overview.md#logger)                |
| **App version** / **build label**                          | `APP_VERSION`, `BUILD_LABEL` (`src/build-env.ts`). [→](overview.md#build-env)                                 |

## The public pages

| Term                                                       | Refers to                                                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Home page** / **landing page** / **showcase**           | `HomePage` (`src/ui/HomePage.tsx`); served at `/home`. [→](overview.md#home-page)                            |
| **Privacy page** / **privacy policy**                      | `PrivacyPage` (`src/ui/PrivacyPage.tsx`); served at `/privacy`. [→](overview.md#privacy-page)                |
