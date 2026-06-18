# Namespaces

A **namespace** is a named, self-contained group of notes. Everything you keep
in one namespace stays separate from every other namespace, so you can run a
personal set of notes and a shared one side by side without one bleeding into
the other. There is always a default namespace, and you can add more whenever
you want to wall off a new area.

When you sync to a local folder, Dropbox, or Google Drive, **each non-default
namespace gets its own folder**. That isolation is the point: you can share one
namespace's folder — say, the `family` one — with the people who need it,
without handing them anything in the rest of your namespaces. The default
namespace keeps the app-folder root it has always used, so existing synced
notes need no migration.

## How it works

1. Open the namespace section at the top of the navigation menu and tap the
   "+" to add a new namespace, giving it a name.
2. While creating it, **pick an icon and a colour**. Both are optional and
   independent — a colour on its own still tints the default folder icon.
3. Switch between namespaces from the same menu; the one you're in is the only
   set of notes you see.
4. Change a namespace's name, icon, or colour later from its row in the manage
   dialog, and the appearance change applies immediately.

While a namespace is active, its icon and colour **badge it in the side menu**
(only the glyph is tinted, never the row text) and the chosen icon, in its
colour, replaces the browser-tab favicon — so a glance tells you which
namespace you're working in. A namespace with only a colour keeps the app's own
mark.

> **Where the data lives.** On the local (this-device) backend each namespace
> is just its own `localStorage` key; the default keeps the historical key.
> On the file/cloud backends each non-default namespace is its own subfolder,
> while the namespace list itself travels with the synced folder as
> `namespaces.json` (beside `settings.json`) so it follows you across devices.
> Which namespace is _active_ is a per-device cursor, not shared state.
