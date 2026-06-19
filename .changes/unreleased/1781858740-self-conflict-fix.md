---
type: Fixed
title: Phantom sync conflicts on a single device
---

Cloud and folder backends no longer raise a false "changed on another device" conflict while you type, by stamping each save's revision from the write itself instead of an eventually-consistent re-listing.
