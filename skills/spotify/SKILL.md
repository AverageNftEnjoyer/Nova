---
name: spotify
description: Controls Spotify playback, stores user playlist and music preferences.
metadata:
  read_when:
    - user asks about spotify
    - play music
    - favorite playlist
    - save playlist
    - spotify skill
    - music preferences
---

# Spotify Skill

## Activation
- Use this skill when the user asks about Spotify, music playback, or music preferences.
- Read this file when the user asks to save a favorite playlist or recall their music preferences.

## Capabilities
- Play, pause, next, previous, seek, volume, shuffle, repeat
- Play from liked songs, recommendations, or a saved favorite playlist
- Save a playlist as the user's favorite so it plays on the smart play button
- Set a favorite playlist by name (for example: "my favorite playlist is called <playlist name>")
- Add the currently playing track to a playlist by name or to the saved favorite playlist
- Answer "what song is playing" using Spotify now-playing state when Spotify is active

## Smart Play Button Behavior
- If the user has a `favorite_playlist_uri` set, the play button plays from that playlist.
- Otherwise, the play button falls back to a random song from liked songs.

## Saving a Favorite Playlist
- When the user says "nova, favorite this playlist" or "save this playlist as my favorite", extract the current playlist URI from Spotify and write it here under `favorite_playlist_uri`.
- When the user says "my favorite playlist is called <name>", resolve the playlist by name in Spotify search, then write both `favorite_playlist_uri` and `favorite_playlist_name`.

## Now Playing Awareness
- For queries like "what song is this playing now", "what is playing currently", or "you're the one playing it", check Spotify now-playing first.
- If a track is playing, report `trackName` + `artistName` and proactively ask if the user wants it added to a playlist.

## Add To Playlist
- If the user says "add this to playlist <name>", add the current track to that playlist.
- If the user says "add this to playlist" with no name, use the saved favorite playlist.
- If no favorite playlist is saved, ask for playlist name.

## User Preference Overrides
- Applies only to this user context.
