# roon-extension-spotify-playlist

Imports a Spotify playlist into a native Roon playlist. Track matching is done with the same ISRC-first / text-fallback cascade Soundiiz and Tune My Music use.

## How it works

1. You paste a Spotify playlist URL into the extension's settings page (inside Roon).
2. The extension fetches the playlist's tracks from Spotify, including each track's ISRC.
3. For each track, it runs a tiered match against your Roon library + connected services (Tidal, Qobuz, local):
   - **Tier 1** — ISRC lookup on Tidal (when Tidal API credentials are configured) → search Roon by Tidal's canonical title/artist.
   - **Tier 2** — Exact normalized title + artist + album.
   - **Tier 3** — Exact normalized title + artist (any release).
   - **Tier 4** — Fuzzy title (Levenshtein ≥ 0.85) + exact artist + duration ±3 s.
   - **Tier 5** — Unmatched. Logged to `unmatched.log`.
4. Matched tracks are added to a new Roon playlist using the Browse API (the same `… → Add to Playlist → New Playlist` path the Roon UI uses).

## Setup

```bash
npm install
npm start
```

On first run:

1. Open Roon → Settings → Extensions and enable this one.
2. Open its settings:
   - **Spotify Client ID**: register an app at <https://developer.spotify.com/dashboard>; redirect URI must be `http://127.0.0.1:8888/callback`.
   - Flip **Connect Spotify** to *Connect now*. The extension prints an authorization URL into the status label and opens a one-shot loopback listener. Open the URL in a browser, approve, and you're done.
   - *(optional)* **Tidal Client ID / Secret**: register at <https://developer.tidal.com>. Without this, ISRC tier is skipped and quality drops to text matching only.
3. Paste a Spotify playlist URL, optionally override the playlist name, choose a zone, and flip **Run import** to *Start*.

Progress is reported in the settings page status label and via `node-roon-api-status` (visible in About → Extensions).

## Limitations

- **Spotify Feb 2026 change**: third-party (non-owned, non-collaborative) playlists return only metadata; the extension surfaces a clear error in that case.
- **Existing playlist with the same name**: tracks are *appended* to it. The extension warns before starting.
- **Roon item_keys are session-scoped**: the extension always re-navigates from search root and never caches keys across runs.
- **Qobuz ISRC lookup is intentionally not implemented**; Qobuz has no public developer program and shared community credentials would breach their ToS. Tidal alone covers the vast majority of releases.

## Testing

```bash
npm test                                            # normalization + scoring unit tests
node -e "require('./src/match/normalize').strip('Song (feat. Drake) - Remastered 2011')"
```

For end-to-end testing, see the verification section of the design plan.
