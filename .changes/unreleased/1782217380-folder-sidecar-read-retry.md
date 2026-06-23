---
type: Fixed
title: Folders dropped by a flaky sidecar read on cloud unlock
---

Reading the folder registry now retries on a transient failure and never caches a folderless result when the read failed, so folders no longer disappear after unlocking on a cloud backend until you switch namespaces.
