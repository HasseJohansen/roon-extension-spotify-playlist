# roon-extension-spotify-playlist

A [Roon](https://roon.app) extension that imports a Spotify playlist — **including public playlists created by other users** — into Roon. It matches each Spotify track against your Roon library / connected streaming services, queues the matches to a zone, and you then save that queue as a Roon playlist.

## Requirements

- A **Roon Core** reachable on the same network (the extension auto-discovers it).
- **Node.js ≥ 20** (24 recommended) — or run the prebuilt **Docker image**.
- A **Spotify account** (a free one works). You log in once from inside Roon — **no Spotify Developer app or Client ID needed.** See the ISRC/account note in [Limitations](#limitations).
- *(Optional)* **Tidal Developer credentials** — enable higher-accuracy ISRC→Tidal matching. Without them, matching is text-based (still works well).
- Tracks must be available in your Roon library or a connected streaming service (Tidal/Qobuz) for Roon to find them.

## How it works

1. You paste a Spotify playlist URL into the extension's settings (inside Roon).
2. It fetches the playlist's tracks the same way for **every** playlist — yours or another user's — straight from Spotify's internal service (the playlist contents plus each track's ISRC), using your single Spotify login.
3. Each track is matched against Roon via search — ISRC→Tidal first, then fuzzy title + artist matching (version-decorator stripping, any-of-many artist matching) with a karaoke/cover guard so it won't pick the wrong version.
4. Matched tracks are **appended to the selected Roon zone's play queue** (Roon's extension API has no way to write a playlist directly).
5. In the Roon app you open that zone's **Queue → ⋮ → Save Queue as Playlist** to keep it.

Unmatched tracks are written to `unmatched.log`, with a full breakdown in `match-report.json`.

## Setup & usage

### Run it

Locally:

```bash
npm install
npm start
```

Or with Docker (e.g. on the machine running Roon, or in Kubernetes):

```bash
docker run -d --network host \
  -v /path/to/config.json:/app/config.json \
  hassejohansen/roon-extension-spotify-playlist:latest
```

`--network host` is required for Roon's discovery; the volume persists the Roon pairing and Spotify token across restarts.

### First-time configuration (in Roon)

1. **Settings → Extensions** → enable **Spotify Playlist Importer**.
2. *(optional)* Open its settings and fill in **Tidal Client ID / Secret / Country Code** — from <https://developer.tidal.com> — for ISRC→Tidal matching.
3. **Connect Spotify → Connect now.** An authorization URL appears in the status label (and the logs); approve it with any (free) Spotify account:
   - **Running locally:** the browser redirect is captured automatically.
   - **Running remotely / Docker / Kubernetes** (browser on a different machine): open the URL in any browser and approve. The `http://127.0.0.1:8888` page failing to load is expected — copy the **redirected URL** (or just the `code=…` value) into the **Paste Spotify auth code** field.
4. The status should read **Spotify: connected**. (See the account-risk note in [Limitations](#limitations).)

### Import a playlist

1. Paste a **Spotify playlist URL**.
2. Choose the **Roon zone** to queue into.
3. **Run import → Start.** Progress shows as `Queuing X/Y → … queued, … unmatched, … errors`.
4. When it finishes, in the Roon app open that zone's **Queue → ⋮ → Save Queue as Playlist** (you name the playlist there). *(Tip: clear the queue first for a clean playlist.)*

## Limitations

- **The single Spotify login uses Spotify's internal client + endpoints, which carries account risk.** Rather than a registered developer app (whose API Spotify gated in Feb 2026 so it can no longer read other users' playlists or per-track ISRC), the extension logs in with Spotify's *first-party* "librespot/keymaster" client and reads playlist contents + ISRC from Spotify's **internal** service (`spclient`). This needs no developer app and a **free** account suffices, but it's undocumented and outside Spotify's Terms — so use it only for personal/self-hosted setups, ideally **not your primary account**. This is what lets one login read both your own and other users' public playlists, with ISRC.
- **Very large playlists may be truncated** by the internal endpoint (it can return a prefix of extremely long playlists). The status/logs warn when fewer tracks were fetched than the playlist's reported total.
- **Why a queue instead of a playlist:** Roon's public extension API has **no playlist-write capability** — it exposes only browsing and playback (search, queue, play), with no "create playlist" or "add to playlist" call. This is a long-standing, deliberate limitation (the feature has been requested in the RoonLabs API repos since 2017 and remains unimplemented). So the extension does the one thing the API *does* allow — appending each matched track to a zone's **play queue** — and you finish by saving that queue as a playlist in the Roon app. That single save is the only manual step.
- **Qobuz ISRC lookup is not implemented** (Qobuz has no public developer program); Tidal covers the vast majority of releases.
- **The OAuth callback is a loopback** (`127.0.0.1:8888`). When the browser is on another machine, use the **Paste Spotify auth code** field (above), or `kubectl port-forward 8888:8888`.

## Testing

```bash
npm test
```
