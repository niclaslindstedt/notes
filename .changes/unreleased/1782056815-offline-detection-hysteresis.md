---
type: Fixed
title: Steadier offline detection
---

A single dropped request no longer flips the app to "offline" — a load that hits a network blip is retried briefly first, so the offline banner only appears during a genuine, sustained outage.
