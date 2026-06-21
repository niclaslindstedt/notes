---
type: Fixed
title: Resilient encryption conversion
---

The background encrypt/decrypt conversion now retries transient backend hiccups with backoff and pauses while offline — resuming on its own when the connection returns — instead of stopping and leaving some notes converted and others not.
