# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial scaffold of the notes PWA: a local-first, mobile-first note-taking
  app built with Vite, React, Tailwind, TypeScript, and vite-plugin-pwa.
- Note list and full-screen editor with auto-save to `localStorage`.
- Dark / Light / System theme toggle backed by a CSS-variable token system.
- PWA service worker with a prompt-style update toast.
- `copy-feature` agent skill for porting features from the `checklist` repo.
