# roon-extension-spotify-playlist

A [Roon](https://roon.app) extension that imports a Spotify playlist — **including public playlists created by other users** — into Roon. It matches each Spotify track against your Roon library / connected streaming services, queues the matches to a zone, and you then save that queue as a Roon playlist.

## Requirements

- A **Roon Core** reachable on the same network (the extension auto-discovers it).
- **Node.js ≥ 20** (24 recommended) — or run the prebuilt **Docker image**.
- A free **Spotify Developer app** (you must use your own — Spotify's API requires it). You need its **Client ID**, and the redirect URI `http://127.0.0.1:8888/callback` registered on it.
- *(Optional)* **Tidal Developer credentials** — enable higher-accuracy ISRC matching for playlists you own. Without them, matching is text-based (still works well).
- Tracks must be available in your Roon library or a connected streaming service (Tidal/Qobuz) for Roon to find them.

## How it works

1. You paste a Spotify playlist URL into the extension's settings (inside Roon).
2. It fetches the playlist's tracks:
   - **Playlists you own / collaborate on** → Spotify Web API (includes each track's ISRC).
   - **Other users' public playlists** → Spotify's public embed (no ISRC available).
3. Each track is matched against Roon via search — ISRC→Tidal for owned playlists, then fuzzy title + artist matching (version-decorator stripping, any-of-many artist matching) with a karaoke/cover guard so it won't pick the wrong version.
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
2. Open its settings and fill in:
   - **Spotify Client ID** — from <https://developer.spotify.com/dashboard>; set its redirect URI to `http://127.0.0.1:8888/callback`.
   - *(optional)* **Tidal Client ID / Secret / Country Code** — from <https://developer.tidal.com>.
3. **Connect Spotify → Connect now.** An authorization URL appears in the status label (and the logs):
   - **Running locally:** the browser redirect is captured automatically.
   - **Running remotely / Docker / Kubernetes** (browser on a different machine): open the URL in any browser and approve. The `http://127.0.0.1:8888` page failing to load is expected — copy the **redirected URL** (or just the `code=…` value) into the **Paste Spotify auth code** field.
4. The status should read **Spotify: connected**.

### Import a playlist

1. Paste a **Spotify playlist URL**.
2. *(optional)* set a **Target playlist name**.
3. Choose the **Roon zone** to queue into.
4. **Run import → Start.** Progress shows as `Queuing X/Y → … queued, … unmatched, … errors`.
5. When it finishes, in the Roon app open that zone's **Queue → ⋮ → Save Queue as Playlist**. *(Tip: clear the queue first for a clean playlist.)*

## Limitations

Most of these come from changes Spotify made to its API (Nov 2024 + Feb 2026):

- **You must supply your own Spotify Client ID.** Spotify no longer issues general API access; each user registers their own developer app.
- **Other users' public playlists can't be read via the official API.** Since Feb 2026 `GET /v1/playlists/{id}/items` only returns tracks for playlists you own or collaborate on. To support other users' playlists this extension reads Spotify's **public embed** instead.
- **No ISRC for other users' playlists.** Spotify also gates the per-track endpoint (`GET /v1/tracks`, returns `403`), and the embed carries no ISRC — so non-owned playlists are matched by **text only** (no Tidal ISRC tier). Match quality is still high, but expect the occasional miss (see `unmatched.log`).
- **Embed scraping is outside Spotify's Developer/Embed Terms** and its undocumented format can change without notice. It's fine for personal/self-hosted use, but not appropriate to redistribute as a public service.
- **Large playlists may be truncated** by the embed (it returns a subset of very long playlists). The status warns when fewer tracks were fetched than the playlist's reported total.
- **Roon's extension API can't create or add to playlists** — there is no such call. That's why the extension queues tracks and you save the queue as a playlist (one manual step).
- **Qobuz ISRC lookup is not implemented** (Qobuz has no public developer program); Tidal covers the vast majority of releases.
- **The OAuth callback is a loopback** (`127.0.0.1:8888`). When the browser is on another machine, use the **Paste Spotify auth code** field (above), or `kubectl port-forward 8888:8888`.

## Testing

```bash
npm test
```
