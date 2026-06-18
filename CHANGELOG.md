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

## [0.2.0] - 2026-06-18

### Added

- **Side menu** — A navigation drawer — docked as a sidebar on wide screens, a drag-out floating button on phones — that lists your notes and links to settings, the source, and the privacy policy.
- **Settings dialog** — A settings dialog opens from the side menu — a skeleton for now, ready to fill as preferences arrive.
- **Privacy policy** — A privacy policy is now served at /privacy, spelling out that notes never leave your device.
- **Theme & appearance** — Settings now has an Appearance panel: pick from eleven built-in themes (One Dark/Light, Dracula, Monokai, GitHub, Solarized, Quiet Light, Excel) or System, choose a font and text size, and build a fully custom theme with your own colours, corner radius, density, and reduced motion.
- **Storage backends** — Choose where your notes live — this device, a local folder of markdown files, or your own Dropbox or Google Drive — with optional passphrase encryption and offline editing. [Learn more](feature:storage)

### Changed

- **Cleaner note list header** — Removed the redundant theme toggle and version label from the note list — theme now lives only in Settings → Appearance, and the version still shows in the side menu under Source.

### Added

- Initial scaffold of the notes PWA: a local-first, mobile-first note-taking
  app built with Vite, React, Tailwind, TypeScript, and vite-plugin-pwa.
- Note list and full-screen editor with auto-save to `localStorage`.
- Dark / Light / System theme toggle backed by a CSS-variable token system.
- PWA service worker with a prompt-style update toast.
- `copy-feature` agent skill for porting features from the `checklist` repo.
