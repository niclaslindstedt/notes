---
type: Fixed
title: A stale device can no longer overwrite newer cloud notes
---

Opening the app on a second device no longer risks writing its old copy over
work another device just synced — a save whose baseline the backend can't
account for now raises the conflict prompt instead, and edits that never
reached the cloud are remembered as unsynced across a restart.
