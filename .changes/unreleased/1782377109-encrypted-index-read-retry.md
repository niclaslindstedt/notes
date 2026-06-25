---
type: Fixed
title: Reliable unlock on flaky connections
---

Unlocking an encrypted cloud vault now retries a dropped read of the note index, and rebuilds a stale index after a fallback, so a brief network blip no longer forces every unlock to slowly re-decrypt every note.
