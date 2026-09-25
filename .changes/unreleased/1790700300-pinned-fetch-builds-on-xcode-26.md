---
type: Fixed
title: The iOS app builds with the current Xcode
---

The certificate-pinning module compared a key type through a cast pattern that the Swift compiler in Xcode 26 rejects, so the iOS build failed there. It now compares the key type as a plain string.
