// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";

import {
  ARCHIVE_ROUTE,
  LIST_ROUTE,
  noteRoute,
  sameRoute,
  useRoute,
  type Route,
} from "../../src/app/use-route.ts";

// jsdom has no session history to step through — `history.back()` is a no-op
// and never fires `popstate`. This is a minimal stand-in: `pushState` /
// `replaceState` keep a stack of states, and `back` / `forward` move a cursor
// and dispatch the event the way a browser does.
function installHistory() {
  const entries: unknown[] = [null];
  let cursor = 0;
  const fire = () => {
    window.dispatchEvent(
      new PopStateEvent("popstate", { state: entries[cursor] }),
    );
  };
  const fake = {
    get state() {
      return entries[cursor];
    },
    pushState(state: unknown) {
      entries.length = cursor + 1;
      entries.push(state);
      cursor += 1;
    },
    replaceState(state: unknown) {
      entries[cursor] = state;
    },
    back() {
      if (cursor === 0) return;
      cursor -= 1;
      fire();
    },
    forward() {
      if (cursor === entries.length - 1) return;
      cursor += 1;
      fire();
    },
    get length() {
      return entries.length;
    },
  };
  Object.defineProperty(window, "history", { value: fake, configurable: true });
  return fake;
}

type Options = { initial?: Route; namespace?: string };

function mount(options: Options = {}) {
  const popped: Route[] = [];
  const view = renderHook(
    (props: { namespace: string }) =>
      useRoute({
        initial: () => options.initial ?? LIST_ROUTE,
        namespace: props.namespace,
        onPop: (next) => popped.push(next),
      }),
    { initialProps: { namespace: options.namespace ?? "default" } },
  );
  return { view, popped };
}

describe("useRoute", () => {
  let history: ReturnType<typeof installHistory>;

  beforeEach(() => {
    history = installHistory();
  });

  it("starts on the initial route and stamps the current entry", () => {
    const { view } = mount({ initial: { kind: "note", id: "a" } });
    expect(view.result.current.route).toEqual({ kind: "note", id: "a" });
    // The entry we were already standing on now carries the route, so a later
    // step back onto it can be resolved.
    expect(history.state).not.toBeNull();
    expect(history.length).toBe(1);
  });

  it("walks back through the notes visited", () => {
    const { view } = mount();
    act(() => view.result.current.go({ kind: "note", id: "a" }));
    act(() => view.result.current.go({ kind: "note", id: "b" }));
    expect(view.result.current.route).toEqual({ kind: "note", id: "b" });

    act(() => history.back());
    expect(view.result.current.route).toEqual({ kind: "note", id: "a" });
    act(() => history.back());
    expect(view.result.current.route).toEqual(LIST_ROUTE);
    // …and forward again.
    act(() => history.forward());
    expect(view.result.current.route).toEqual({ kind: "note", id: "a" });
  });

  it("reports every applied step to onPop", () => {
    const { view, popped } = mount();
    act(() => view.result.current.go({ kind: "note", id: "a" }));
    act(() => history.back());
    act(() => history.forward());
    expect(popped).toEqual([LIST_ROUTE, { kind: "note", id: "a" }]);
  });

  it("does not stack an entry for the route already showing", () => {
    const { view } = mount();
    act(() => view.result.current.go({ kind: "note", id: "a" }));
    act(() => view.result.current.go({ kind: "note", id: "a" }));
    expect(history.length).toBe(2);
  });

  it("replace leaves no back step behind", () => {
    const { view } = mount();
    act(() => view.result.current.go({ kind: "note", id: "a" }));
    act(() => view.result.current.replace(LIST_ROUTE));
    expect(view.result.current.route).toEqual(LIST_ROUTE);
    expect(history.length).toBe(2);
    // Stepping back lands on the entry before the note, not on the note.
    act(() => history.back());
    expect(view.result.current.route).toEqual(LIST_ROUTE);
  });

  it("backTo steps the browser back when that is where the target is", () => {
    const { view } = mount();
    act(() => view.result.current.go({ kind: "note", id: "a" }));
    act(() => view.result.current.backTo(LIST_ROUTE));
    expect(view.result.current.route).toEqual(LIST_ROUTE);
    // Stepped back rather than pushed — bouncing in and out of a note doesn't
    // grow the stack.
    expect(history.length).toBe(2);
    act(() => history.forward());
    expect(view.result.current.route).toEqual({ kind: "note", id: "a" });
  });

  it("backTo navigates when the entry behind is something else", () => {
    const { view } = mount();
    act(() => view.result.current.go({ kind: "note", id: "a" }));
    act(() => view.result.current.go({ kind: "note", id: "b" }));
    // Note A sits behind us, not the overview — so the editor's back button
    // has to navigate, and note B stays reachable by stepping back.
    act(() => view.result.current.backTo(LIST_ROUTE));
    expect(view.result.current.route).toEqual(LIST_ROUTE);
    expect(history.length).toBe(4);
    act(() => history.back());
    expect(view.result.current.route).toEqual({ kind: "note", id: "b" });
  });

  it("never steps past the entry the app started on", () => {
    const { view } = mount();
    act(() => view.result.current.backTo(LIST_ROUTE));
    // Nothing of ours sits behind entry 0, so this navigates (and no-ops,
    // since we're already on the list) instead of leaving the app.
    expect(history.length).toBe(1);
  });

  it("lands on the overview when a step crosses into another namespace", () => {
    const { view } = mount({
      initial: { kind: "note", id: "a" },
      namespace: "work",
    });
    act(() => view.result.current.go({ kind: "note", id: "b" }));
    // Switching namespace replaces the entry we're on; the one behind still
    // names a note from the namespace we left, whose id means nothing here.
    view.rerender({ namespace: "recipes" });
    act(() => view.result.current.replace(LIST_ROUTE));
    act(() => history.back());
    expect(view.result.current.route).toEqual(LIST_ROUTE);
  });

  it("resumes on the entry's route after a reload", () => {
    const first = mount({ initial: { kind: "note", id: "a" } });
    act(() => first.view.result.current.go(ARCHIVE_ROUTE));
    first.view.unmount();
    // A reload keeps the entry's state but rebuilds the hook, whose `initial`
    // reads the (stale) remembered note.
    const second = mount({ initial: { kind: "note", id: "a" } });
    expect(second.view.result.current.route).toEqual(ARCHIVE_ROUTE);
  });

  it("ignores a popstate for an entry it never stamped", () => {
    const { view, popped } = mount();
    act(() => view.result.current.go({ kind: "note", id: "a" }));
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });
    expect(view.result.current.route).toEqual({ kind: "note", id: "a" });
    expect(popped).toEqual([]);
  });

  it("preserves foreign state already on the entry", () => {
    window.history.replaceState({ oauth: "pending" }, "");
    const { view } = mount();
    act(() => view.result.current.go({ kind: "note", id: "a" }));
    act(() => history.back());
    expect(history.state).toMatchObject({ oauth: "pending" });
  });
});

describe("route helpers", () => {
  it("resolves a note id to a route, or the overview without one", () => {
    expect(noteRoute("a")).toEqual({ kind: "note", id: "a" });
    expect(noteRoute(null)).toEqual(LIST_ROUTE);
  });

  it("compares routes by kind and id", () => {
    expect(sameRoute(LIST_ROUTE, { kind: "list" })).toBe(true);
    expect(sameRoute(LIST_ROUTE, ARCHIVE_ROUTE)).toBe(false);
    expect(
      sameRoute({ kind: "note", id: "a" }, { kind: "note", id: "a" }),
    ).toBe(true);
    expect(
      sameRoute({ kind: "note", id: "a" }, { kind: "note", id: "b" }),
    ).toBe(false);
    expect(
      sameRoute({ kind: "note", id: "a" }, { kind: "archived", id: "a" }),
    ).toBe(false);
  });
});
