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

## Smart Play Button Behavior
- If the user has a `favorite_playlist_uri` set, the play button plays from that playlist.
- Otherwise, the play button falls back to a random song from liked songs.

## Saving a Favorite Playlist
- When the user says "nova, favorite this playlist" or "save this playlist as my favorite", extract the current playlist URI from Spotify and write it here under `favorite_playlist_uri`.

## User Preference Overrides
- Applies only to this user context.
