# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

From the first release onward, released sections below are **generated at
release time from the changeset fragments** in `.changes/unreleased/` — add
a fragment per user-visible change (see `AGENTS.md` → "Releases and
changelog"). The pre-release notes under `[Unreleased]` are hand-written and
predate the pipeline.

## [Unreleased]

## [1.4.0] - 2026-07-18

### Added

- **Fold the side menu footer away for more note-list room** — A thin chevron rail now sits just above the side menu footer. Tap it to fold
  the Donate, trophy, About and Settings rows away, handing that vertical space to
  your note list so more notes fit on screen; tap it again to bring the footer
  back. The choice is remembered across reloads, and the footer now sits snug
  against the bottom of the drawer instead of floating above a dead strip.
- **Pick up where you left off** — Switching between notes now returns you to the exact caret position and scroll offset you left each note at — same line, same place on screen — for as long as the app stays open; on a phone the keyboard comes back up with the caret already placed.
- **Encryption enforced across devices** — Turn on at-rest encryption from one device and every other device syncing the same folder now locks and asks for the same passphrase, while plaintext notes left by another device are pulled into the encrypted vault automatically.
- **Self-hosted sync (notesd)** — In the installed app you can now pair with your own self-hosted notesd server and sync your notes privately over your network, with no cloud and no accounts. [Learn more](feature:notesd)
- **Discover your self-hosted server across devices** — Pairing a notesd server now publishes its address and certificate pin to your connected Dropbox or Google Drive, so your other devices find it in Settings without re-scanning the QR. [Learn more](feature:notesd)
- **Self-hosted settings & namespace sync** — The self-hosted (notesd) backend now syncs your appearance settings and namespace list across every paired device, the way the folder and cloud backends already do.
- **Scan a notesd pairing QR** — In the installed app you can now pair a self-hosted notesd server by scanning the QR code it prints with your camera, instead of pasting the code by hand.
- **Self-hosted attachments & full-folder sync** — The self-hosted (notesd) backend now stores each note as its own Markdown file with its images as real files beside them and syncs every namespace, so pasted attachments and all your namespaces travel between paired devices — and the daemon's folder opens directly in the web folder backend. [Learn more](feature:notesd)

### Changed

- **Clearer nested-list bullets** — Nested bulleted lists in the live preview now draw `•`, `-`, and `+` by level, using characters the app font renders so the markers stay crisp and centred on every device.
- **Smoother scroll into focus** — Tapping a line or field on mobile now glides it clear of the soft keyboard instead of snapping, respecting the reduced-motion preference.
- **Undo a paragraph sentence by sentence** — Undo in the note editor now steps back one finished sentence at a time instead of wiping a whole typing burst in one go, so a long paragraph can be walked back sentence by sentence — while the sentence you're still typing stays whole until you move on to the next.
- **Undo/redo scrolls to the change** — Undo and redo now scroll the editor to the part of the note being reverted or re-applied, so a change that happened off screen is revealed instead of shifting out of sight.
- **Shared UI foundation** — Dialogs, pickers, gestures, and the update prompt now come from the shared oss-framework package — full-screen sheets can be swiped down to close, and deleting a namespace asks for confirmation in a proper dialog.
- **Tighter note list** — The overview's cards now sit closer together with a more compact excerpt, so more notes fit on screen and the page scrolls less.
- **Self-hosted live sync** — Self-hosted (notesd) devices now receive another device's edits by watching the daemon's revision instead of re-downloading the whole document every few seconds.

### Fixed

- **Select all on desktop** — Ctrl/Cmd+A pressed before clicking into the note body now selects the whole note — ready to be typed over, cut, or copied — instead of the browser selecting the entire page, title included.
- Google Drive sync now reads every page of large folders, so namespaces with more than 100 notes or attachments no longer sync incompletely.
- **Tapped line hidden by the keyboard** — Tapping a line near the bottom of a note on mobile now scrolls it clear of the soft keyboard instead of leaving it hidden behind it, even for the very last line.
- **Undo/redo keyboard shortcuts inside the editor** — ⌘/Ctrl+Z and ⌘/Ctrl+Shift+Z / Ctrl+Y now undo and redo while the caret is in a note, instead of doing nothing.
- **Typed text no longer disappears around cloud saves** — Automatic pulls (foregrounding the app, opening a note, the live-sync poll) now stand down while an edit is still unsaved or a save is in flight, so text typed while Dropbox/Drive/folder sync is saving can no longer vanish from the screen.
- **Trailing divider renders when you leave the note** — A horizontal rule (or heading, list, or quote) typed on the last line now renders formatted as soon as the editor loses focus, instead of staying raw markdown until you tap back in.
- **Undo and redo are scoped to the open note** — Undo/redo (the buttons and ⌘/Ctrl+Z / ⌘/Ctrl+Y) now walk the history of the note you're actually looking at, so switching notes no longer reverts edits in a different one, and erasing what you typed before typing something else is now its own step instead of being swallowed by the next edit.
- **Turning off encryption no longer wipes your notes** — On the This-device backend, disabling encryption now decrypts the stored document before re-saving it as plaintext, instead of overwriting your notes with an empty document.
- **Turning off encryption on a synced folder or cloud no longer blanks notes** — On the local-folder, Dropbox, and Google Drive backends, turning encryption off now keeps every note's text: an unopened note no longer opens blank afterwards, and editing one note can no longer save empty files over the others.
- **Tapped line pushed off the top by the keyboard** — Tapping a line near the top of a note on mobile no longer flings it above the header and out of sight when the soft keyboard opens — the reveal now scrolls only the editor, keeping the caret comfortably in view.
- **Editor keeps the cursor on screen** — Typing at the foot of the editor — pressing Enter on the bottom line — now scrolls the note so the caret stays visible with a blank line of breathing room beneath it, instead of letting it slip off screen.
- **Edits stick on open** — Editing a note right after opening it no longer risks the change silently reverting when a slow cloud read finishes — an edit made while the backend load is still in flight is now kept instead of overwritten.
- **Even spacing between note cards** — Note cards in the overview are evenly spaced again: a long preview no longer inflates its card with empty space on iOS, which had read as a large uneven gap before the next card.

## [1.3.0] - 2026-07-01

### Added

- **Drag a folder to another namespace** — Drag a folder from the side menu onto another namespace to move it there with every note filed inside it.
- **Search your notes** — Search every note's title and body from the magnifier on the side-menu action bar — plain-text and fuzzy by default, with wildcard and /regex/ support, and it works across encrypted notes without unlocking them.

### Changed

- **Editor selection & navigation** — Rebuilt the live-preview editor on a single editable surface so Select All grabs the whole note, arrow keys glide across wrapped lines, and you can select across lines on mobile.
- **Sharper list and divider rendering** — Ordered lists now number themselves sequentially (1., 2., 3.) whatever digits you type, nested lists indent and rotate their markers by depth (numeric → a. → i. for numbered, • → ◦ → ▪ for bulleted, the top-level bullet drawn a little larger and vertically centred on its line), and a line that is just a single `-` renders as a horizontal divider.

### Fixed

- **Reliable unlock on flaky connections** — Unlocking an encrypted cloud vault now retries a dropped read of the note index, and rebuilds a stale index after a fallback, so a brief network blip no longer forces every unlock to slowly re-decrypt every note.
- **Capitalize new paragraphs on mobile** — The mobile keyboard now capitalizes the first letter of a new line in the live-preview editor, matching the first line and the plain-text editor.
- **Overview scroll bounds** — The note overview no longer rubber-bands past the end of the list on iOS, so it stops cleanly at the last note instead of overscrolling into empty space.
- **Copy raw Markdown** — Selecting all and copying (or cutting) a note now carries the full raw Markdown — headings, list, and quote markers included — instead of dropping them.
- **Editor scroll bounds** — Scrolling to the bottom of a note on mobile now stops on the last line — kept above the iOS safe area instead of scrolling away under it — rather than overscrolling into empty space.
- **Tapping a line scrolls it clear of the keyboard** — Tapping a line in the lower half of a note on mobile now scrolls it into view so the caret no longer hides behind the soft keyboard.

## [1.2.1] - 2026-06-24

### Fixed

- **Drag-and-drop reliability** — Dragging a note no longer freezes mid-air when you release away from the row or when a sync conflict surfaces mid-drag, and dragging a note downward into a folder no longer triggers pull-to-refresh at the same time.

## [1.2.0] - 2026-06-24

### Changed

- **Instant unlock for encrypted notes** — Unlocking an encrypted vault now renders the whole list at once from a small encrypted index and decrypts each note's body only when you open it, so a large vault opens instantly instead of decrypting every note up front. [Learn more](feature:per-note-encryption)
- **Lock glyph shows decrypt state** — The encryption lock on each note is now green once its body has been decrypted and loaded this session and gray while it's still sealed-but-deferred, so a glance at the list tells which notes open instantly.

### Fixed

- **Fast unlock right after enabling encryption** — The first unlock after turning on encryption now renders instantly from the note index instead of decrypting every note one by one — the background conversion seals the index as soon as it finishes.

## [1.1.0] - 2026-06-23

### Changed

- **Button island and About dropdown in the side menu** — The side menu's New note / New folder / Show all / Archive buttons and Undo / Redo now share one bordered button island at the foot of the list, and the footer's project links fold into a tidy "About" dropdown.

### Fixed

- **Folders dropped by a flaky sidecar read on cloud unlock** — Reading the folder registry now retries on a transient failure and never caches a folderless result when the read failed, so folders no longer disappear after unlocking on a cloud backend until you switch namespaces.
- **Even button-island spacing and trimmed note titles** — The side-menu button island now sits with the same gap below it as on its sides, and a note title can no longer start or end with a space.

## [1.0.1] - 2026-06-23

### Added

- **Collapsible namespaces** — The Namespaces section in the side menu now collapses behind a chevron on its heading — collapsed by default and showing just the active namespace — so the drawer leads with your notes.

### Changed

- **Compact folder picker on mobile** — The editor's folder picker now shows just its icon on phones to save header space, and the icon glows in the accent colour when a note is filed in a folder.

### Fixed

- **New-folder row alignment** — The inline "new folder" input now lines up its folder glyph with the existing folders' glyphs instead of sitting one notch to the left.
- **Folders after unlocking on a cloud backend** — The folder registry is now read directly from its sidecar rather than trusting the directory listing, so folders (including empty ones) show immediately after unlocking encryption on app start instead of only after switching namespaces.

## [1.0.0] - 2026-06-22

### Added

- **Namespaces** — Keep separate, self-contained groups of notes — switch between them from the side menu, give each its own icon and colour, and sync each to its own shareable folder. [Learn more](feature:namespaces)
- **Live Markdown editor** — Notes now render Markdown as you write — headings, bold, italics, lists, quotes, code, links and more format inline, while the line your cursor is on stays raw source so it's always editable, just like Obsidian.
- **Editor settings** — A new Editor settings tab adjusts the writing-column margins, toggles word wrap (off scrolls long lines sideways instead), and turns live Markdown rendering on or off.
- **Enter starts your first note** — On the empty notes screen, pressing Enter now creates your first note without reaching for the mouse.
- **Showcase homepage** — A public landing page at `/home` that introduces the app, describes what it does, and explains why cloud sync may request access to your own Google Drive or Dropbox — with a link to the privacy policy.
- **What's new dialog** — A "What's new" dialog in the side menu lists every shipped release from the changelog, and a release note's "Learn more" link opens the matching feature doc inline.
- **Undo and redo** — Creating, editing, and deleting notes is now recorded on an undo timeline — step back and forth with Ctrl/⌘+Z (and Ctrl/⌘+Shift+Z or Ctrl+Y to redo) or the new Undo / Redo entries in the side menu, so an accidental deletion or a regretted change is one tap away from coming back.
- **Update download hint** — The header "Notes" wordmark now fills with the accent colour from the bottom as a new build downloads, and the "new version is ready" prompt was slimmed to a single-line reload hint.
- **Achievements** — Earn trophies as you discover features — a header button lights up with what you've unlocked, opens a four-tier tour of the whole catalog, and can be switched off in Settings. [Learn more](feature:achievements)
- **Languages** — The whole interface now speaks English and Swedish — pick one in Settings → General and the app follows your choice (it defaults to your device language and is remembered on this device).
- **Spell check & autocorrect toggles** — Settings → Editor adds two independent toggles — disable spell check (hides the red squiggles) and disable auto correct (stops mobile autocorrect and auto-capitalisation) — handy for code, structured notes, or another language.
- **Each note has its own title field** — A note's title is now a dedicated field at the top of the editor — typed there rather than as the first body line, rendered like a heading, and stored as `title:` in the markdown frontmatter; existing notes have their first line lifted into it automatically.
- **Logs settings tab** — Settings has a Logs tab — a live, filterable, copyable view of the app's own diagnostics (ported from budget), so a sync problem like a phantom "changed on another device" conflict can be captured on a phone and pasted straight into a bug report.
- **Developer mode** — Settings → General now has a developer-mode switch that reveals a Developer tab for diagnostics; the Logs tab and across-reloads log capture only appear once developer mode is on.
- **Swipe to archive or delete** — Swipe a note right in the overview to archive it (restore it later from the new Archive view) or left to uncover a Delete button — both undoable.
- **Pull to refresh** — Pull down on the note list to fetch the latest from a connected folder or cloud, and notes now also refresh automatically when you reopen the app or open a note — fetching only what changed.
- **Default note titles** — New notes can be named automatically — by date and time, or with a running "Note", "Note 2", … — chosen in Settings → Editor.
- **Swipe the side menu closed** — Swipe the open side menu back toward its edge — from the menu or the dimmed area beside it — to close it: it follows your finger and slides shut, the mirror of the edge swipe that opens it.
- **Drag-and-drop import** — On desktop, drop Markdown files anywhere on the app to import each as a note, using its filename as the title.
- **Image attachments** — Paste or drag an image into a note on a local-folder or cloud backend and it's saved as a file in an attachments folder and shown inline as a clickable thumbnail.
- **Live note sync** — With a folder or cloud backend connected, notes now pulls edits from the backend every few seconds, so a change made on one device appears on your others on its own — even with the note open, as long as you've paused typing. [Learn more](feature:live-sync)
- **Copy a note to the clipboard** — A copy button beside the sync glyph copies the open note to the clipboard — the body alone by default, or the title and body or the whole Markdown file with its YAML frontmatter, chosen from a dropdown in Settings → Editor.
- **Encryption progress feedback** — Turning encryption on or off now shows a live status bar of what it's doing and spins the button while it works, and a failed attempt becomes a tappable status line that opens the full log so you can see what went wrong.
- **Fake data toggle** — Developer settings gain a "Fake data" toggle that previews the app against an in-memory sample document for the session without touching your real notes — a reload (or turning it off) restores them.
- **Bare URLs become links** — A plain URL typed or pasted into a note (`http://…`, `https://…`, or `www.…`) now renders as a clickable link without needing `[text](url)` syntax, so you can tap it to open it.
- **Tidy notes on save** — Notes are now tidied each time they're saved — trailing spaces are trimmed from every line and the note ends with a single newline — and both can be turned off under Settings → Editor → Formatting on save.
- **File attachments** — Paste or drag any file — not just images — into the editor on a folder or cloud backend: non-image files attach as a downloadable chip with a type icon, and a new Editor setting can collect images and files in a block at the end of the note instead of inline.
- **Right-click menu on desktop** — On a computer, right-click a note in the overview or the side menu for a quick menu of its actions — archive, restore, and delete — replacing the touch swipe gestures.
- **Per-note sync spinner** — Notes being uploaded to a folder or cloud backend now show a small spinner next to them — in the overview, the side menu, and in place of the glyph beside the title of the note you're editing — so you can see exactly which notes are still syncing, not just the single status glyph in the header.
- **Shorten links** — The live preview can now trim long pasted URLs down to the domain, a few characters either side of a `[...]` marker — toggle it and pick the length in Settings → Editor (the full link is still saved and still opens).
- **Card layout for the note list** — Settings → Appearance → Note list now switches the overview between compact rows and taller cards that show several lines of each note and fade the tail out.
- **Folders** — Group notes into folders inside a namespace — create one from the Notes heading in the side menu, drag notes onto it (or use a note's folder picker), and expand a folder to add notes straight inside it.
- **Drag notes into folders on mobile** — On a touchscreen, press and hold a note in the side menu or overview to pick it up, then drag it onto a folder to file it.
- **Drag a note to a namespace or the archive** — In the side menu you can now drag a note onto another namespace to move it there, or onto Archive to archive it — by long-press on touch or drag on desktop.
- **List layout for the overview** — The note list gains a third layout — **List** — a bare file-explorer listing that shows each note as a single title row, nested under its folder.
- **Edit and delete folders from the overview** — Folders in the overview now swipe left to reveal edit/delete (and right-click for the same actions on a computer), matching the side menu.

### Changed

- **Tabbed settings** — Settings now open on a General tab with Appearance and Storage as their own tabs, and the General tab can hide the floating menu button (an edge swipe opens the menu in its place) on installed mobile.
- **Cloud sync status glyph and details modal** — The header sync chip is now a single cloud glyph that morphs with the save state (synced, unsaved, saving, offline, or a clear error), and tapping it opens a details modal that spells out what sync is doing, why it failed, and the buttons to fix it — reconnect, save now, reload, or open the backend's folder.
- **Cloud sync command centre** — The cloud-sync glyph now always opens a redesigned details dialog that shows live activity (which files are uploading, encryption progress note-by-note), the backend and at-rest encryption state side by side, a compact reload control beside the status, and an always-available sync log you can read without turning on developer mode.
- **Centered new-note button** — The floating new-note (+) button is now horizontally centered at the bottom of the screen instead of anchored to the right.
- **Privacy policy covers sync backends** — The privacy policy now describes the optional folder, Dropbox, and Google Drive sync backends, the OAuth scopes they request, the at-rest encryption option, and the offline cache.
- **Namespace switcher affordance** — The Namespaces heading now uses a cogwheel for its manage action, and the active namespace is marked with a check.
- **Icon-only editor header buttons** — The editor's Back and Delete actions are now compact glyph buttons matching the sync and achievements affordances.
- **Clearer sync conflict prompt** — When the same notes change on two devices, the conflict prompt now summarises each copy side by side (note and word counts) and stays open until you pick a side, so a conflict can't be dismissed by accident.
- **Section-divided General settings** — The General settings tab is now split into labelled cards, and the language picker shows the English and Swedish flags.
- **Note files now live in a notes/ subfolder** — On the folder and cloud backends each note's markdown file is now stored under a `notes/` subfolder (`<namespace>/notes/` for a namespace you created), apart from the `settings.json` beside it — existing notes kept at the old location won't appear until their `.md` files are moved into the new folder.
- **Logs tab restyle** — The Logs settings tab now lists each entry as a card with a level-coloured left rail and the message on its own line, and filters by level through a dropdown.
- **Archive is now a page** — The archive moved to the foot of the notes list with a count badge and opens as a full page (not a dialog), so you can swipe the side menu open over it; tapping an archived note shows it read-only with floating Restore and Delete actions, and Restore reopens it editable.
- **Note titles head the page** — The note title now heads the editor beside the app glyph and the Back button is gone — return to the overview with the new "Show all" entry in the side menu, which keeps its list focused on your most recent notes.
- **Tap a note title to select it** — Clicking or tabbing into a note's title now selects the whole title, so you can rename it by typing straight away instead of erasing it first.
- **New notes open ready to be named** — A new note opens with its title selected so you can rename it by just typing, and on folder/cloud backends its file isn't written until you leave the title — so it's created already bearing the right name instead of being saved under a default and renamed.
- **Archive from the side menu** — Right-swipe a note in the side menu to archive it, mirroring the overview, and the editor drops its now-redundant top-right delete button.
- **Transparent favicon** — The browser-tab favicon is now just the note glyph on a transparent background, with the dark backing square removed.
- **Achievements moved to the side menu** — The achievements trophy now lives as a row in the side menu — tinted once you've earned your first one, greyed out until then, with a badge counting unacknowledged unlocks.
- **Compact cloud sync details modal** — The cloud-sync details modal now opens as a compact centered card instead of filling the whole screen on mobile, so its short status content no longer leaves a sea of dead space.
- **Wrapping note titles** — A long note title now wraps onto further lines in the editor header instead of being cut off, with the copy and sync buttons pinned to the top.
- **Menu activation control** — The installed mobile app now picks how the side menu opens — floating button or right-swipe — with a segmented toggle instead of a single on/off switch.
- **Note glyph opens the menu** — Pressing the document glyph beside a note's title now opens the side menu, and the glyph sits vertically aligned with the title.
- **Custom copy-scope dropdown** — The Editor tab's copy-button behaviour picker is now a themed custom dropdown with full keyboard navigation, replacing the native select.
- **Calmer note opening and centred titles** — Opening an existing note no longer pops the soft keyboard — focus stays out until you tap where to type — and a short note title is now vertically centred against the header icons, top-aligning only once it wraps onto a second line.
- **Grouped editor settings** — The Editor settings tab now groups its controls into focused sections — New notes, Writing column, Markdown, Typing aids, and Copying — instead of one long list.
- **One-tap delete in the side menu** — Deleting a note from the side menu no longer asks for a confirming second tap — the trash button a left swipe reveals deletes straight away, since deletions are undoable.
- **Undo / redo buttons** — The side menu's Undo and Redo now sit as a compact pair of side-by-side buttons pinned to the foot of the drawer, just above the Source link, so they stay within thumb's reach instead of taking two full rows in an Edit section.
- **Image viewer gallery, swipe-to-dismiss, and tidy previews** — The full-size image viewer is now a gallery — swipe up or down (or tap the X, the backdrop, or Escape) to dismiss, and step through a note's images with the on-screen arrows, the arrow keys, or a left/right swipe, with the neighbouring images peeking in at the edges on a wide screen the way Finder does; deleting an image from a note now also removes its underlying attachment, and image markdown no longer clutters a note's preview in the overview.
- **Desktop "New note" button** — On wider screens — where the side menu is docked as a permanent sidebar — the round floating (+) button now relaxes into a clearly-styled, in-flow "New note" pill, so it no longer reads as an awkward puck beside the pinned chrome; the circular floating action button is kept on narrow viewports.
- **Settings save bar** — The settings dialog now previews appearance changes live and only applies them on Save, with a Reset to defaults / Cancel / Save footer matching the rest of the app.
- **Encryption runs in the background** — Turning at-rest encryption on or off on a folder/cloud backend now converts your notes one at a time in the background — you can close settings right away, and the status flashes exactly which note and attachment it's working on if you keep it open. [Learn more](feature:per-note-encryption)
- **Folder row actions** — A folder's edit and delete now hide behind a left swipe (or a right-click on desktop) instead of always-on buttons, and the right-click action menus are sized to their contents rather than spanning the whole row.
- **Folder highlight spacing** — When you drag a note onto a folder in the overview, the folder's highlight now sits a little off its notes instead of hugging them edge to edge.
- **Update-ready toast** — Redesigned the update-ready prompt with a clear **Update** button and a tidy headline that no longer wraps awkwardly on mobile.
- **Roomier, sortable side menu** — New note, Show all, and Archive now share one compact button row; each folder gets a "+" to start a note inside it; and Settings → Appearance → Sidebar lets you pin folders above your notes or mix them in, sorted by name or last modified.
- **Folders are real directories on disk** — On the local-folder and cloud (Dropbox / Google Drive) backends a note filed into a folder is now stored in a real subdirectory named after that folder, so the synced folder is browsable and organized in any file manager — the note's `folder:` frontmatter is kept as the authoritative link.
- **New folder joins the action bar** — The sidebar's New folder action moves off the Notes heading into the bar below the note list, now a flush four-up segmented row of icon-only buttons (New note, New folder, Show all, Archive).
- **Cleaner New folder glyph** — The sidebar's New folder action now shows a plain folder glyph, matching the weight of the other action-bar buttons.
- **Side-menu active highlight** — The active note and namespace now keep their own icon and are marked with an accent row highlight that stands out from the hover state, instead of swapping in a checkmark.
- **Back button in the editor header** — The glyph left of the note title is now a back button that returns to the overview, instead of a menu toggle.
- **Unlock progress feedback** — The passphrase unlock screen now shows a spinner on the Unlock button and an unlock-specific status line ("Checking your passphrase…", "Decrypting your notes…", "Unlocking your notes…"), and on a folder or cloud backend it names each note as it's decrypted ("Decrypting “Groceries” (3/12)…") so a long unlock shows real progress instead of sitting blank.
- **Sidebar stays open when switching namespace** — Switching the active namespace from the side menu no longer closes the drawer, so you can hop between several namespaces in one go.
- **Encryptish progress for encryption status** — The encryption status line — in Storage settings and on the unlock screen — now shows a gently scrambling cipher mark instead of a spinner.
- **Faster encryption at scale** — Encrypted folder/cloud vaults with hundreds of notes now unlock far faster (notes decrypt in parallel instead of one at a time) and stay snappy while editing (each save re-encrypts only the note you changed, not the whole vault).
- **Notes list shows a loading hint when switching namespaces** — Switching into a folder or cloud namespace whose notes aren't cached on this device yet now shows a spinner instead of the misleading "No notes yet." until the document finishes loading.
- **Resume your open note** — Reloading or upgrading the app now reopens the note you had open instead of dropping you back to the overview, and each namespace remembers its own open note.
- **Italic "No folder"** — The folder picker now renders the "No folder" option in italics to set it apart from named folders.

### Fixed

- **Enter and delete on mobile keyboards** — Pressing Enter, Backspace or Delete in the Markdown editor now works on mobile soft keyboards, so a line you finish typing splits and renders its formatting instead of staying stuck as raw source.
- **Cloud sync in production** — Google Drive and Dropbox now appear in the deployed app — the Pages build wires their app credentials in from GitHub Actions secrets instead of building without them.
- **Full-height side menu** — The navigation drawer now fills the whole screen in the iOS standalone PWA, so its footer links stay pinned to the bottom instead of floating mid-panel.
- **Modals cover the new-note button** — The floating "+" button no longer paints on top of an open dialog, such as the cloud-sync details modal opened from the header.
- **Phantom sync conflicts on a single device** — Cloud and folder backends now sync each note as its own file — only the notes you actually changed are uploaded, and a save raises a "changed on another device" conflict only when a note you're editing really moved remotely — so typing no longer collides with your own in-flight or lagging uploads.
- **Tap anywhere to edit** — Tapping anywhere in the note space now starts editing, even when the note is only a single line.
- **Note title matches the body font** — The note title field now inherits the editor's font family and left alignment instead of falling back to the browser's default control font, so it reads as a true H1 heading of the note rather than a mismatched form input.
- **Title respects the editor margin like the body** — The note title no longer drifts inward and centers on its own when an editor margin is set — it now shares the body's writing column, so the two stay left-aligned at every margin.
- **Renaming a note no longer triggers sync conflicts** — Editing a note's title now renames its file on the cloud/folder backends once, when you leave the title field, instead of on every keystroke — so a flaky connection mid-edit no longer surfaces a phantom "changed on another device" conflict.
- **Frozen top toolbar** — The header toolbar now stays pinned in place when the on-screen keyboard opens on mobile, instead of scrolling away with the note.
- **Keyboard dismissed when opening the menu** — Opening the side menu while editing now retracts the mobile keyboard so the note list is visible instead of looking empty.
- **Steady top bar and scrolling** — The whole page no longer rubber-bands on mobile — the header stays put instead of being dragged out of view when you scroll without the keyboard, and the editor scrolls smoothly to the bottom with the keyboard open instead of jittering.
- **Holding Backspace keeps erasing across lines** — Holding Backspace in the Markdown editor now keeps deleting onto the previous line instead of getting stuck at the start of an emptied line, so a held Backspace erases continuously the way it does everywhere else.
- **Side-menu archive swipe** — Swiping a note right to archive in the side menu no longer flashes the red delete button as the row slides off.
- **Encryption toggle converts existing notes** — Turning encryption on now re-encrypts your existing notes at rest (and turning it off decrypts them), instead of leaving the old plaintext files sitting beside the encrypted blob on a synced folder or cloud.
- **Cleaner "Open in" sync button** — The cloud-sync details "Open in Dropbox" button no longer trails an "(encrypted)" suffix — it names the destination service, not the at-rest encryption state.
- **Disabling encryption removes the encrypted file** — Turning encryption off now always rewrites your notes as plaintext and deletes the leftover `notes.json` envelope, even when a stale plaintext copy was shadowing it on a synced folder or cloud.
- **Clickable links in the editor** — Clicking a link in the Markdown editor now opens it instead of dropping the caret into it — even while another line is being edited — so links are followable on tap; to change a link, click just past it and backspace into it.
- **Edge swipe no longer triggers browser back/forward** — Disabled the browser's native left/right edge-swipe history navigation so it stops interfering with the side menu's own swipe gestures.
- **Image viewer** — A pasted second image no longer renders as a black thumbnail, the gallery now slides smoothly between images on swipe instead of snapping back, and the image counter no longer stretches into a lopsided pill above the home indicator.
- **Image viewer close button** — The image viewer's close button no longer stretches into a pill above the X on devices with a top safe-area inset.
- **Tap below an image to keep writing** — Tapping the empty space below a note now drops the caret on a fresh blank line at the bottom, so you can keep typing under an image without first turning it back into raw Markdown.
- **Entering edit mode no longer touches the date** — Opening a note and placing the caret without typing no longer bumps its modified date or jumps it to the top of the list.
- **Drop overlay no longer sticks** — The full-window "Drop to import" overlay now clears when you drop an image or file onto a note to attach it, instead of staying up.
- **Dropbox app folder name** — The Dropbox backend now syncs to the correct `free-notes` app folder, configurable at build time via `VITE_DROPBOX_APP_FOLDER`.
- **Notes open fully formatted** — Opening a note now renders every line as Markdown — including the last line (or the only line) — instead of leaving it as raw plain text until you tap into it.
- **Select across lines in the editor** — You can now drag to select text across multiple lines in the live-preview editor and copy it — the copy keeps the verbatim Markdown source and full, un-shortened URLs rather than the truncated on-screen text.
- **Instant note list on cloud reload** — Cloud backends now paint your last-synced notes from the offline cache on first frame instead of flashing an empty list while the network load runs.
- **Drag chip no longer flashes at the top-left** — When picking up a note to drag it on a touchscreen, the floating chip now appears at your fingertip immediately instead of briefly flashing in the top-left corner until you move.
- **Encryption passphrase stays visible on mobile** — Focusing the passphrase fields in Settings → Storage now scrolls them above the on-screen keyboard instead of leaving them hidden behind it.
- **Folder picker height** — The editor header's folder picker now matches the height of the copy and sync buttons beside it.
- **Instant namespace switching** — Switching namespace (or reloading) now paints the target's notes and folders from a cached index right away, instead of showing the previous namespace's notes for several seconds while the new ones load.
- **Resilient encryption conversion** — The background encrypt/decrypt conversion now retries transient backend hiccups with backoff and pauses while offline — resuming on its own when the connection returns — instead of stopping and leaving some notes converted and others not.
- **Steadier offline detection** — A single dropped request no longer flips the app to "offline" — a load that hits a network blip is retried briefly first, so the offline banner only appears during a genuine, sustained outage.
- **Faster encrypted unlock and sync** — Unlocking an encrypted folder/cloud namespace no longer decrypts every note twice, and idle background syncs reuse already-decrypted notes instead of re-reading the whole vault.

### Security

- **Per-note, per-attachment encryption** — At-rest encryption now seals each note as its own compressed, opaquely-named encrypted file and each attachment as its own encrypted blob — never folded together — so a note opens by downloading only its own attachments, on demand, and a green lock fills in note-by-note as a paced background migration seals everything without flooding the cloud; every conversion is atomic, so nothing can be lost. [Learn more](feature:per-note-encryption)

## [0.2.0] - 2026-06-18

### Added

- **Side menu** — A navigation drawer — docked as a sidebar on wide screens, a drag-out floating button on phones — that lists your notes and links to settings, the source, and the privacy policy.
- **Settings dialog** — A settings dialog opens from the side menu — a skeleton for now, ready to fill as preferences arrive.
- **Privacy policy** — A privacy policy is now served at /privacy, spelling out that notes never leave your device.
- **Theme & appearance** — Settings now has an Appearance panel: pick from eleven built-in themes (One Dark/Light, Dracula, Monokai, GitHub, Solarized, Quiet Light, Excel) or System, choose a font and text size, and build a fully custom theme with your own colours, corner radius, density, and reduced motion.
- **Storage backends** — Choose where your notes live — this device, a local folder of markdown files, or your own Dropbox or Google Drive — with optional passphrase encryption and offline editing. [Learn more](feature:storage)

### Changed

- **Cleaner note list header** — Removed the redundant theme toggle and version label from the note list — theme now lives only in Settings → Appearance, and the version still shows in the side menu under Source.

## [0.1.0] - 2026-06-18

### Added

- Initial scaffold of the notes PWA: a local-first, mobile-first note-taking
  app built with Vite, React, Tailwind, TypeScript, and vite-plugin-pwa.
- Note list and full-screen editor with auto-save to `localStorage`.
- Dark / Light / System theme toggle backed by a CSS-variable token system.
- PWA service worker with a prompt-style update toast.
- `copy-feature` agent skill for porting features from the `checklist` repo.
