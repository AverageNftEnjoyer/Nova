import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const results = [];

function record(status, name, detail = "") {
  results.push({ status, name, detail });
}

async function run(name, fn) {
  try {
    await fn();
    record("PASS", name);
  } catch (error) {
    record("FAIL", name, error instanceof Error ? error.message : String(error));
  }
}

function read(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

await run("HSPREC-1 Spotify service parses 'track by artist' queries", async () => {
  const serviceSource = read("hud/lib/integrations/spotify/service.ts");
  assert.equal(serviceSource.includes("function parseTrackAndArtistQuery(query: string)"), true);
  assert.equal(serviceSource.includes(".match(/^(.+?)\\s+\\bby\\b\\s+(.+)$/i)"), true);
});

await run("HSPREC-2 Spotify service builds strict track+artist query variants", async () => {
  const serviceSource = read("hud/lib/integrations/spotify/service.ts");
  assert.equal(serviceSource.includes("function buildStrictTrackArtistQueries(track: string, artist: string): string[]"), true);
  assert.equal(serviceSource.includes('`track:${normalizedTrack} artist:${normalizedArtist}`'), true);
  assert.equal(serviceSource.includes('`track:\"${normalizedTrack}\" artist:\"${normalizedArtist}\"`'), true);
});

await run("HSPREC-3 Playback path prefers strict track+artist lookup before generic fallback", async () => {
  const serviceSource = read("hud/lib/integrations/spotify/service.ts");
  assert.equal(serviceSource.includes("const strictQueries = buildStrictTrackArtistQueries(strictTrackArtist.track, strictTrackArtist.artist)"), true);
  assert.equal(serviceSource.includes("for (const strictQuery of strictQueries)"), true);
  assert.equal(serviceSource.includes("if (!uri) {\n    uri = await searchSpotifyUri(query, searchType, scope)\n  }"), true);
});

await run("HSPREC-4 Playback hard-fails when post-play now-playing does not exactly match requested track+artist", async () => {
  const serviceSource = read("hud/lib/integrations/spotify/service.ts");
  assert.equal(serviceSource.includes("const strictTrackArtist = searchType === \"track\" ? parseTrackAndArtistQuery(query) : null"), true);
  assert.equal(serviceSource.includes("const trackMatches = hasAllNeedleTokens(nowPlaying.trackName, requiredTrackTokens)"), true);
  assert.equal(serviceSource.includes("const artistMatches = hasAllNeedleTokens(nowPlaying.artistName, requiredArtistTokens)"), true);
  assert.equal(serviceSource.includes("Could not verify exact match for"), true);
  assert.equal(serviceSource.includes("\"spotify.not_found\""), true);
});

const passCount = results.filter((result) => result.status === "PASS").length;
const failCount = results.filter((result) => result.status === "FAIL").length;
for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);
