---
type: Added
title: Line breaks in find and replace
---

With the find bar's `.*` switch on, `\n` now matches a real line break in the
search and writes one in the replacement — so a pattern can span two lines, and
replacing every `·` with `\n- [ ] ` turns a run-on list into a checklist.
