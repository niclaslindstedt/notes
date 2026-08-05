// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import {
  ARCHIVE_ROUTE,
  LIST_ROUTE,
  hashToRoute,
  noteRoute,
  routeNamespace,
  routeToHash,
  sameRoute,
  useRoute,
  type Route,
} from "../../src/app/use-route.ts";

// jsdom implements real session history — pushState / replaceState with a URL,
// traversal, and both `popstate` and `hashchange` — so these run against the
// browser's own machinery rather than a stand-in. It has no way to *clear* the
// stack between cases, so entry counts are asserted as deltas.
const NOTE_A: Route = { kind: "note", ns: "work", id: "a" };
const NOTE_B: Route = { kind: "note", ns: "work", id: "b" };

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
async function travel(step: "back" | "forward") {
  await act(async () => {
    window.history[step]();
    await settle();
  });
}

function mount(options: { initial?: Route } = {}) {
  const popped: Route[] = [];
  const view = renderHook(() =>
    useRoute({
      initial: () => options.initial ?? LIST_ROUTE,
      onPop: (next) => popped.push(next),
    }),
  );
  return { view, popped, nav: () => view.result.current };
}

describe("useRoute", () => {
  let entriesBefore = 0;

  beforeEach(() => {
    // A push, not a replace: jsdom can't clear the stack between cases, and
    // pushing both lands us on a clean unstamped address *and* drops whatever
    // a case that ended mid-stack left ahead of us — so `history.length` moves
    // by exactly what the case under test pushes.
    window.history.pushState(null, "", "/");
    entriesBefore = window.history.length;
  });
  const entriesAdded = () => window.history.length - entriesBefore;

  it("starts on the initial route and stamps the current entry", () => {
    const { nav } = mount({ initial: NOTE_A });
    expect(nav().route).toEqual(NOTE_A);
    expect(nav().fromLink).toBe(false);
    // The entry we were already standing on now carries the note's address, so
    // it can be copied straight out of the bar, and a later step back onto it
    // knows where it goes.
    expect(window.location.hash).toBe("#/n/work/a");
    expect(entriesAdded()).toBe(0);
  });

  it("opens the note a link names, whatever was remembered", () => {
    window.history.replaceState(null, "", "/#/n/recipes/soup");
    const { nav } = mount({ initial: NOTE_A });
    expect(nav().route).toEqual({ kind: "note", ns: "recipes", id: "soup" });
    expect(nav().fromLink).toBe(true);
  });

  it("puts each note's link in the address bar, and clears it on the list", () => {
    const { view, nav } = mount();
    expect(window.location.hash).toBe("");
    act(() => nav().go(NOTE_A));
    expect(window.location.hash).toBe("#/n/work/a");
    act(() => nav().go(ARCHIVE_ROUTE));
    expect(window.location.hash).toBe("#/archive");
    act(() => nav().go({ kind: "archived", ns: "work", id: "old" }));
    expect(window.location.hash).toBe("#/archive/work/old");
    act(() => nav().go(LIST_ROUTE));
    expect(window.location.hash).toBe("");
    view.unmount();
  });

  it("walks back through the notes visited", async () => {
    const { nav } = mount();
    act(() => nav().go(NOTE_A));
    act(() => nav().go(NOTE_B));
    expect(nav().route).toEqual(NOTE_B);

    await travel("back");
    expect(nav().route).toEqual(NOTE_A);
    expect(window.location.hash).toBe("#/n/work/a");
    await travel("back");
    expect(nav().route).toEqual(LIST_ROUTE);
    await travel("forward");
    expect(nav().route).toEqual(NOTE_A);
  });

  it("reports every applied step to onPop, but not the app's own moves", async () => {
    const { nav, popped } = mount();
    act(() => nav().go(NOTE_A));
    expect(popped).toEqual([]);
    await travel("back");
    await travel("forward");
    expect(popped).toEqual([LIST_ROUTE, NOTE_A]);
    expect(nav().fromLink).toBe(false);
  });

  it("does not stack an entry for the route already showing", () => {
    const { nav } = mount();
    act(() => nav().go(NOTE_A));
    act(() => nav().go({ kind: "note", ns: "work", id: "a" }));
    expect(entriesAdded()).toBe(1);
  });

  it("replace leaves no back step behind", async () => {
    const { nav } = mount();
    act(() => nav().go(NOTE_A));
    act(() => nav().replace(LIST_ROUTE));
    expect(nav().route).toEqual(LIST_ROUTE);
    expect(entriesAdded()).toBe(1);
    await travel("back");
    // The note is gone from the stack: stepping back skips over where it was.
    expect(nav().route).toEqual(LIST_ROUTE);
  });

  it("backTo steps the browser back when that is where the target is", async () => {
    const { nav } = mount();
    act(() => nav().go(NOTE_A));
    await act(async () => {
      nav().backTo(LIST_ROUTE);
      await settle();
    });
    expect(nav().route).toEqual(LIST_ROUTE);
    // Stepped back rather than pushed — bouncing in and out of a note doesn't
    // grow the stack, and the note is still ahead of us.
    expect(entriesAdded()).toBe(1);
    await travel("forward");
    expect(nav().route).toEqual(NOTE_A);
  });

  it("backTo navigates when the entry behind is something else", async () => {
    const { nav } = mount();
    act(() => nav().go(NOTE_A));
    act(() => nav().go(NOTE_B));
    // Note A sits behind us, not the overview — so the editor's back button
    // has to navigate, and note B stays reachable by stepping back.
    act(() => nav().backTo(LIST_ROUTE));
    expect(nav().route).toEqual(LIST_ROUTE);
    expect(entriesAdded()).toBe(3);
    await travel("back");
    expect(nav().route).toEqual(NOTE_B);
  });

  it("follows a link pasted into the address bar while running", async () => {
    const { nav, popped } = mount();
    act(() => nav().go(NOTE_A));
    await act(async () => {
      window.location.hash = "#/n/journal/entry-1";
      await settle();
    });
    expect(nav().route).toEqual({ kind: "note", ns: "journal", id: "entry-1" });
    expect(nav().fromLink).toBe(true);
    expect(popped).toEqual([{ kind: "note", ns: "journal", id: "entry-1" }]);
    // And it's a step of its own: back returns to the note we came from.
    await travel("back");
    expect(nav().route).toEqual(NOTE_A);
  });

  it("ignores an address it doesn't recognise", async () => {
    const { nav } = mount();
    act(() => nav().go(NOTE_A));
    await act(async () => {
      window.location.hash = "#/somewhere/else";
      await settle();
    });
    expect(nav().route).toEqual(NOTE_A);
  });

  it("falls back to the address when an entry's state was wiped", async () => {
    const { nav } = mount();
    act(() => nav().go(NOTE_A));
    act(() => nav().go(NOTE_B));
    await travel("back");
    // Something else owning the URL (the OAuth cleanup in `useCloudBackend`)
    // replaces the entry's state with null; the address still names the note.
    window.history.replaceState(null, "", window.location.href);
    await travel("forward");
    await travel("back");
    expect(nav().route).toEqual(NOTE_A);
  });

  it("resumes on the entry's route after a reload", () => {
    const first = mount();
    act(() => first.nav().go(ARCHIVE_ROUTE));
    first.view.unmount();
    // A reload keeps the entry's state and address; drop the address to prove
    // the state alone carries the tab back to where it was.
    window.history.replaceState(window.history.state, "", "/");
    const second = mount({ initial: NOTE_A });
    expect(second.nav().route).toEqual(ARCHIVE_ROUTE);
    expect(second.nav().fromLink).toBe(false);
  });

  it("preserves foreign state already on the entry", () => {
    window.history.replaceState({ oauth: "pending" }, "", "/");
    const { nav } = mount();
    act(() => nav().go(NOTE_A));
    expect(window.history.state).toMatchObject({ oauth: "pending" });
  });
});

describe("route helpers", () => {
  it("resolves a note id to a route, or the overview without one", () => {
    expect(noteRoute("a", "work")).toEqual(NOTE_A);
    expect(noteRoute(null, "work")).toEqual(LIST_ROUTE);
  });

  it("names the namespace a route's ids belong to", () => {
    expect(routeNamespace(NOTE_A)).toBe("work");
    expect(routeNamespace({ kind: "archived", ns: "old", id: "x" })).toBe(
      "old",
    );
    expect(routeNamespace(LIST_ROUTE)).toBeNull();
    expect(routeNamespace(ARCHIVE_ROUTE)).toBeNull();
  });

  it("compares routes by kind, namespace, and id", () => {
    expect(sameRoute(LIST_ROUTE, { kind: "list" })).toBe(true);
    expect(sameRoute(LIST_ROUTE, ARCHIVE_ROUTE)).toBe(false);
    expect(sameRoute(NOTE_A, { kind: "note", ns: "work", id: "a" })).toBe(true);
    expect(sameRoute(NOTE_A, NOTE_B)).toBe(false);
    // Same id, different namespace — different notes.
    expect(sameRoute(NOTE_A, { kind: "note", ns: "home", id: "a" })).toBe(
      false,
    );
    expect(sameRoute(NOTE_A, { kind: "archived", ns: "work", id: "a" })).toBe(
      false,
    );
  });

  it("round-trips every route through its address", () => {
    for (const route of [
      LIST_ROUTE,
      ARCHIVE_ROUTE,
      NOTE_A,
      { kind: "archived", ns: "work", id: "old-1" } as Route,
    ]) {
      expect(hashToRoute(routeToHash(route))).toEqual(route);
    }
  });

  it("escapes and unescapes the parts of an address", () => {
    const route: Route = { kind: "note", ns: "my notes", id: "a/b?c" };
    expect(routeToHash(route)).toBe("#/n/my%20notes/a%2Fb%3Fc");
    expect(hashToRoute(routeToHash(route))).toEqual(route);
  });

  it("reads an address the app never wrote as nothing to act on", () => {
    expect(hashToRoute("#/n/work")).toBeNull();
    expect(hashToRoute("#/n//a")).toBeNull();
    expect(hashToRoute("#/notes/work/a")).toBeNull();
    expect(hashToRoute("#/archive/work")).toBeNull();
    // The bare app, and the archive, are addresses it does write.
    expect(hashToRoute("")).toEqual(LIST_ROUTE);
    expect(hashToRoute("#/")).toEqual(LIST_ROUTE);
    expect(hashToRoute("#/archive")).toEqual(ARCHIVE_ROUTE);
  });
});
