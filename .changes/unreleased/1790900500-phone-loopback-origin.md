---
type: Changed
title: The phone app serves itself from a server on the device
---

The iPhone and Android app now loads the notes app from a small server inside the app, at `http://localhost:8311`, instead of from local files. Nothing leaves the device. If you sync with your own Nextcloud from the phone, the origin its CORS settings have to allow is `http://localhost:8311`.
