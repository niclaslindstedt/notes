// The pure half of the Nextcloud backend: the multistatus parser and the
// input normalisers the connect form leans on. Both are the pieces a bad
// server response or a mistyped address hits first, and neither needs a
// network or a DOM — which is exactly why they live apart from the adapter.

import { describe, expect, it } from "vitest";

import {
  basicAuth,
  encodePath,
  hrefPathname,
  normalizeEtag,
  normalizeFolder,
  normalizeServerUrl,
  parseMultistatus,
} from "../../src/storage/nextcloud/webdav.ts";

const ROOT = "/remote.php/dav/files/alice/notes/notes";

function multistatus(...responses: string[]): string {
  return (
    '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">' +
    responses.join("") +
    "</d:multistatus>"
  );
}

function fileResponse(href: string, etag: string): string {
  return (
    `<d:response><d:href>${href}</d:href><d:propstat><d:prop>` +
    `<d:getetag>${etag}</d:getetag><d:resourcetype/>` +
    "</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>"
  );
}

function collectionResponse(href: string): string {
  return (
    `<d:response><d:href>${href}</d:href><d:propstat><d:prop>` +
    "<d:resourcetype><d:collection/></d:resourcetype>" +
    "</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>"
  );
}

describe("parseMultistatus", () => {
  it("returns the files inside the listed collection, not the collection itself", () => {
    const xml = multistatus(
      collectionResponse(`${ROOT}/`),
      fileResponse(`${ROOT}/hello.md`, '"abc123"'),
      collectionResponse(`${ROOT}/work/`),
    );
    expect(parseMultistatus(xml, ROOT)).toEqual([
      { path: "hello.md", etag: "abc123", collection: false },
      { path: "work", collection: true },
    ]);
  });

  it("decodes percent-encoded hrefs back to the real file name", () => {
    const xml = multistatus(
      fileResponse(`${ROOT}/caf%C3%A9%20noir.md`, '"e1"'),
    );
    expect(parseMultistatus(xml, ROOT)[0]?.path).toBe("café noir.md");
  });

  it("accepts an absolute href, any namespace prefix, and a weak etag", () => {
    const xml =
      '<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">' +
      `<D:response><D:href>https://cloud.test${ROOT}/a.md</D:href>` +
      "<D:propstat><D:prop><D:getetag>W/&quot;weak&quot;</D:getetag>" +
      "<D:resourcetype/></D:prop></D:propstat></D:response></D:multistatus>";
    expect(parseMultistatus(xml, ROOT)).toEqual([
      { path: "a.md", etag: "weak", collection: false },
    ]);
  });

  it("ignores entries that fall outside the listed collection", () => {
    const xml = multistatus(
      fileResponse("/remote.php/dav/files/alice/elsewhere.md", '"e2"'),
      fileResponse(`${ROOT}/mine.md`, '"e3"'),
    );
    expect(parseMultistatus(xml, ROOT).map((e) => e.path)).toEqual(["mine.md"]);
  });

  it("tolerates a root given without its trailing slash and a file with no etag", () => {
    const xml = multistatus(
      `<d:response><d:href>${ROOT}/bare.md</d:href><d:propstat><d:prop>` +
        "<d:resourcetype/></d:prop></d:propstat></d:response>",
    );
    expect(parseMultistatus(xml, `${ROOT}/`)).toEqual([
      { path: "bare.md", collection: false },
    ]);
  });
});

describe("hrefPathname", () => {
  it("keeps a rooted path and strips the origin off an absolute URL", () => {
    expect(hrefPathname("/a/b.md")).toBe("/a/b.md");
    expect(hrefPathname("https://cloud.test/a/b.md")).toBe("/a/b.md");
  });

  it("returns null rather than throwing on an undecodable href", () => {
    expect(hrefPathname("/a/%zz.md")).toBeNull();
  });
});

describe("normalizeServerUrl", () => {
  it("defaults a bare host to https and drops trailing slashes", () => {
    expect(normalizeServerUrl("cloud.example.com")).toBe(
      "https://cloud.example.com",
    );
    expect(normalizeServerUrl(" https://cloud.example.com/// ")).toBe(
      "https://cloud.example.com",
    );
  });

  it("keeps a subpath install and an explicit http scheme", () => {
    expect(normalizeServerUrl("http://box.lan:8080/nextcloud/")).toBe(
      "http://box.lan:8080/nextcloud",
    );
  });

  it("rejects an empty or malformed address", () => {
    expect(() => normalizeServerUrl("   ")).toThrow();
    expect(() => normalizeServerUrl("https://")).toThrow();
  });
});

describe("normalizeFolder", () => {
  it("strips the slashes around a folder path", () => {
    expect(normalizeFolder("/Apps/notes/")).toBe("Apps/notes");
    expect(normalizeFolder("  notes  ")).toBe("notes");
    expect(normalizeFolder("")).toBe("");
  });

  it("refuses to walk out of the account root", () => {
    expect(() => normalizeFolder("../../etc")).toThrow();
  });
});

describe("encodePath / normalizeEtag / basicAuth", () => {
  it("encodes each segment but keeps the separators", () => {
    expect(encodePath("notes/café noir.md")).toBe("notes/caf%C3%A9%20noir.md");
  });

  it("unwraps a quoted or weak etag", () => {
    expect(normalizeEtag('"abc"')).toBe("abc");
    expect(normalizeEtag('W/"abc"')).toBe("abc");
  });

  it("encodes credentials as UTF-8 before base64", () => {
    expect(basicAuth("alice", "s3cret")).toBe(`Basic ${btoa("alice:s3cret")}`);
    // `btoa` alone throws above U+00FF; the header must survive an é.
    expect(() => basicAuth("renée", "påssword")).not.toThrow();
  });
});
