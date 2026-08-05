import { describe, expect, it } from "vitest";

import {
  hasYouTubeLink,
  isYouTubeUrl,
  youtubeEmbedSrc,
  youtubeThumbnailSrc,
  youtubeVideo,
  youtubeWatchUrl,
} from "../../src/domain/youtube.ts";

const ID = "dQw4w9WgXcQ";

describe("youtubeVideo", () => {
  it("reads the id out of every link shape YouTube hands out", () => {
    const urls = [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtube.com/watch?v=${ID}`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://music.youtube.com/watch?v=${ID}`,
      `http://www.youtube.com/watch?v=${ID}`,
      `www.youtube.com/watch?v=${ID}`,
      `youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}`,
      `https://www.youtube.com/embed/${ID}`,
      `https://www.youtube-nocookie.com/embed/${ID}`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/live/${ID}`,
      `https://www.youtube.com/v/${ID}`,
      `https://www.youtube.com/watch/${ID}`,
    ];
    for (const url of urls) {
      expect(youtubeVideo(url), url).toEqual({ id: ID });
    }
  });

  it("trims the parameters a shared link drags along", () => {
    expect(
      youtubeVideo(
        `https://m.youtube.com/watch?v=${ID}&pp=ygUKcmljayByb2xs%3D&ra=m&feature=share`,
      ),
    ).toEqual({ id: ID });
    expect(youtubeVideo(`https://youtu.be/${ID}?si=aBcDeFgHiJkLmNoP`)).toEqual({
      id: ID,
    });
    expect(
      youtubeVideo(
        `https://www.youtube.com/watch?app=desktop&v=${ID}&list=PL123&index=4&ab_channel=Someone`,
      ),
    ).toEqual({ id: ID });
  });

  it("keeps the timestamp, in every spelling", () => {
    expect(youtubeVideo(`https://youtu.be/${ID}?t=90`)).toEqual({
      id: ID,
      start: 90,
    });
    expect(youtubeVideo(`https://www.youtube.com/watch?v=${ID}&t=90s`)).toEqual(
      {
        id: ID,
        start: 90,
      },
    );
    expect(
      youtubeVideo(`https://www.youtube.com/watch?v=${ID}&t=1h2m3s`),
    ).toEqual({ id: ID, start: 3723 });
    expect(
      youtubeVideo(`https://www.youtube.com/embed/${ID}?start=42`),
    ).toEqual({ id: ID, start: 42 });
    expect(youtubeVideo(`https://www.youtube.com/watch?v=${ID}#t=30`)).toEqual({
      id: ID,
      start: 30,
    });
  });

  it("ignores a timestamp it can't read, rather than refusing the link", () => {
    expect(youtubeVideo(`https://youtu.be/${ID}?t=soon`)).toEqual({ id: ID });
    expect(youtubeVideo(`https://youtu.be/${ID}?t=0`)).toEqual({ id: ID });
  });

  it("decodes a percent-encoded id", () => {
    expect(
      youtubeVideo(`https://www.youtube.com/watch?v=abc%2Ddef%5Fghi`),
    ).toEqual({ id: "abc-def_ghi" });
  });

  it("is not a YouTube link", () => {
    const urls = [
      "",
      "not a url",
      "https://example.com/watch?v=dQw4w9WgXcQ",
      // A look-alike host that merely ends in the same letters.
      "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
      "https://myyoutube.com.evil.example/watch?v=dQw4w9WgXcQ",
      // The right host, but not a single video.
      "https://www.youtube.com/@someChannel",
      "https://www.youtube.com/results?search_query=cats",
      "https://www.youtube.com/playlist?list=PL123",
      "https://www.youtube.com/embed/videoseries?list=PL123",
      // The right shape, but the id isn't one (ids are 11 characters).
      "https://www.youtube.com/watch?v=short",
      `https://www.youtube.com/watch?v=${ID}extra`,
      // Not a web link at all.
      `javascript:https://youtu.be/${ID}`,
    ];
    for (const url of urls) {
      expect(youtubeVideo(url), url).toBeNull();
    }
    expect(isYouTubeUrl(`https://youtu.be/${ID}`)).toBe(true);
    expect(isYouTubeUrl("https://example.com")).toBe(false);
  });
});

describe("youtubeEmbedSrc", () => {
  it("rebuilds the player URL on the no-cookie host, from the id alone", () => {
    expect(youtubeEmbedSrc({ id: ID })).toBe(
      `https://www.youtube-nocookie.com/embed/${ID}?rel=0&playsinline=1`,
    );
  });

  it("carries autoplay and the start offset", () => {
    expect(youtubeEmbedSrc({ id: ID, start: 90 }, { autoplay: true })).toBe(
      `https://www.youtube-nocookie.com/embed/${ID}?autoplay=1&start=90&rel=0&playsinline=1`,
    );
  });

  it("points the poster and the way out at the same video", () => {
    expect(youtubeThumbnailSrc({ id: ID })).toBe(
      `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`,
    );
    expect(youtubeWatchUrl({ id: ID, start: 12 })).toBe(
      `https://www.youtube.com/watch?v=${ID}&t=12`,
    );
  });
});

describe("hasYouTubeLink", () => {
  it("spots a link anywhere in a note body", () => {
    expect(hasYouTubeLink(`watch this later\n\nhttps://youtu.be/${ID}\n`)).toBe(
      true,
    );
    expect(
      hasYouTubeLink(`[the song](https://www.youtube.com/watch?v=${ID})`),
    ).toBe(true);
    expect(hasYouTubeLink("no links here\nhttps://example.com/a")).toBe(false);
    expect(hasYouTubeLink("")).toBe(false);
  });
});
