import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: path.join(process.cwd(), "hud", ".env.local"), override: false });
loadDotenv({ path: path.join(process.cwd(), "hud", ".env"), override: false });
loadDotenv({ path: path.join(process.cwd(), ".env.local"), override: false });
loadDotenv({ path: path.join(process.cwd(), ".env"), override: false });

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

const userContextId = String(
  process.env.NOVA_SMOKE_USER_CONTEXT_ID || "dd5ea07a-b92e-4ce8-a5f9-fe229168c80f",
).trim().toLowerCase();

const spotifyServiceModule = await import(
  pathToFileURL(path.join(process.cwd(), "hud/lib/integrations/spotify/service.ts")).href
);
const spotifyTokensModule = await import(
  pathToFileURL(path.join(process.cwd(), "hud/lib/integrations/spotify/tokens.ts")).href
);
const spotifyPrefsModule = await import(
  pathToFileURL(path.join(process.cwd(), "hud/lib/integrations/spotify/skill-prefs.ts")).href
);

const { findSpotifyPlaylistByQuery } = spotifyServiceModule;
const { getSpotifyGrantedScopes, getValidSpotifyAccessToken } = spotifyTokensModule;
const {
  readSpotifySkillPrefs,
  writeSpotifyFavoritePlaylist,
  clearSpotifyFavoritePlaylist,
} = spotifyPrefsModule;

const scope = {
  userId: userContextId,
  allowServiceRole: true,
  serviceRoleReason: "scheduler",
};
const requiredScopes = [
  "playlist-read-private",
  "playlist-modify-private",
  "playlist-modify-public",
];

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

async function fetchUserPlaylists() {
  const token = await getValidSpotifyAccessToken(false, scope);
  const collected = [];
  const seen = new Set();
  for (let page = 0; page < 3; page += 1) {
    const limit = 50;
    const offset = page * limit;
    const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    const response = await fetch(`https://api.spotify.com/v1/me/playlists?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    assert.equal(response.ok, true, `spotify playlist fetch failed: ${response.status}`);
    const payload = await response.json().catch(() => null);
    const items = Array.isArray(payload?.items) ? payload.items : [];
    for (const item of items) {
      const id = String(item?.id || "").trim();
      const uri = String(item?.uri || "").trim();
      const name = String(item?.name || "").trim();
      if (!id || !uri || !name || seen.has(id)) continue;
      seen.add(id);
      collected.push({ id, uri, name });
    }
    if (!payload?.next) break;
  }
  return collected;
}

function pickDistinctByName(playlists, count) {
  const picked = [];
  const seen = new Set();
  for (const playlist of playlists) {
    const key = normalizeName(playlist.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    picked.push(playlist);
    if (picked.length >= count) break;
  }
  return picked;
}

const originalPrefs = readSpotifySkillPrefs(userContextId);

try {
  const grantedScopes = await getSpotifyGrantedScopes(scope);
  const grantedSet = new Set(grantedScopes.map((s) => String(s || "").trim().toLowerCase()).filter(Boolean));
  const missingScopes = requiredScopes.filter((scopeName) => !grantedSet.has(scopeName));
  if (missingScopes.length > 0) {
    throw new Error(
      `Spotify connection missing required scopes for live playlist tests: ${missingScopes.join(", ")}. Reconnect Spotify integrations.`,
    );
  }

  const playlists = await fetchUserPlaylists();
  const picked = pickDistinctByName(playlists, 3);
  assert.equal(picked.length >= 3, true, "Need at least 3 distinct Spotify playlists for live test.");
  const [p1, p2, p3] = picked;

  await run("LIVE-SPOTIFY-1 exact playlist lookup + favorite set persists", async () => {
    const resolved = await findSpotifyPlaylistByQuery(p1.name, scope);
    assert.equal(Boolean(resolved.match), true, "expected exact match for playlist 1");
    const sameNameUris = new Set(
      playlists.filter((p) => normalizeName(p.name) === normalizeName(p1.name)).map((p) => p.uri),
    );
    assert.equal(sameNameUris.has(String(resolved.match?.uri || "")), true, "resolved URI not in user playlists");
    const write = writeSpotifyFavoritePlaylist(userContextId, resolved.match.uri, resolved.match.name || p1.name);
    assert.equal(write.ok, true, write.message || "favorite write failed");
    const prefs = readSpotifySkillPrefs(userContextId);
    assert.equal(prefs.favoritePlaylistUri, resolved.match.uri);
    assert.equal(normalizeName(prefs.favoritePlaylistName).length > 0, true);
  });

  await run("LIVE-SPOTIFY-2 incorrect playlist name suggests close match, correction succeeds", async () => {
    const wrongQuery = `${p2.name} definitely-not-real`;
    const wrong = await findSpotifyPlaylistByQuery(wrongQuery, scope);
    assert.equal(wrong.match, null, "wrong query unexpectedly returned exact match");
    assert.equal(
      wrong.suggestions.some((name) => normalizeName(name) === normalizeName(p2.name)),
      true,
      "expected corrected playlist in suggestions",
    );
    const corrected = await findSpotifyPlaylistByQuery(p2.name, scope);
    assert.equal(Boolean(corrected.match), true, "expected corrected query to resolve");
    const write = writeSpotifyFavoritePlaylist(
      userContextId,
      corrected.match.uri,
      corrected.match.name || p2.name,
    );
    assert.equal(write.ok, true, write.message || "favorite write failed for corrected playlist");
    const prefs = readSpotifySkillPrefs(userContextId);
    assert.equal(prefs.favoritePlaylistUri, corrected.match.uri);
  });

  await run("LIVE-SPOTIFY-3 third playlist resolves, then unfavorite clears persisted favorite", async () => {
    const resolved = await findSpotifyPlaylistByQuery(p3.name, scope);
    assert.equal(Boolean(resolved.match), true, "expected exact match for playlist 3");
    const write = writeSpotifyFavoritePlaylist(userContextId, resolved.match.uri, resolved.match.name || p3.name);
    assert.equal(write.ok, true, write.message || "favorite write failed for playlist 3");
    const clear = clearSpotifyFavoritePlaylist(userContextId);
    assert.equal(clear.ok, true, clear.message || "clear favorite failed");
    const prefs = readSpotifySkillPrefs(userContextId);
    assert.equal(String(prefs.favoritePlaylistUri || "").trim(), "");
    assert.equal(String(prefs.favoritePlaylistName || "").trim(), "");
  });
} finally {
  if (String(originalPrefs.favoritePlaylistUri || "").trim()) {
    writeSpotifyFavoritePlaylist(
      userContextId,
      originalPrefs.favoritePlaylistUri,
      originalPrefs.favoritePlaylistName || "favorite playlist",
    );
  } else {
    clearSpotifyFavoritePlaylist(userContextId);
  }
}

const passCount = results.filter((r) => r.status === "PASS").length;
const failCount = results.filter((r) => r.status === "FAIL").length;
for (const result of results) {
  const detail = result.detail ? ` :: ${result.detail}` : "";
  console.log(`[${result.status}] ${result.name}${detail}`);
}
console.log(`\nSummary: pass=${passCount} fail=${failCount}`);
if (failCount > 0) process.exit(1);
