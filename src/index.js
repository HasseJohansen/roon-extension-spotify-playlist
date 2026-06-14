'use strict';

const fs = require('fs');
const path = require('path');

const { createExtension } = require('./roon/extension');
const { buildLayout } = require('./roon/settings');
const { parseAuthInput, SpotifyTokenStore } = require('./spotify/auth');
const {
  beginInternalAuth,
  startInternalCallbackServer,
  exchangeInternalCode,
  KEYMASTER_CLIENT_ID,
  INTERNAL_REDIRECT_URI,
} = require('./spotify/internal-auth');
const { InternalMetadataClient } = require('./spotify/internal-metadata');
const { TidalClient } = require('./tidal/isrc');
const { runImport } = require('./importer');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const REPORT_DIR = path.join(__dirname, '..');

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return {}; }
}
function writeConfig(c) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2));
}

const cfg = readConfig();

const state = {
  core: null,
  values: {
    spotifyConnect: 'idle',
    spotifyAuthCode: '',
    tidalClientId: cfg.tidalClientId || '',
    tidalClientSecret: cfg.tidalClientSecret || '',
    tidalCountryCode: cfg.tidalCountryCode || 'US',
    playlistUrl: '',
    zone: cfg.zone || null,
    runImport: 'idle',
    showResults: 'idle',
  },
  spotifyStatus: 'Spotify: not connected',
  tidalStatus: 'Tidal ISRC lookup: disabled',
  runStatus: 'Idle',
  lastSummary: '',
  lastReport: null, // per-track outcomes of the most recent import
  showResults: false, // whether the results breakdown is expanded
  cancelRequested: false,
  importing: false,
};

// Single Spotify login: the librespot/keymaster token (no developer app). It
// reads every playlist — yours and other users' — with ISRC, via Spotify's
// internal endpoints. Persisted as `internalSpotifyTokens`.
const tokenStore = new SpotifyTokenStore({
  clientId: KEYMASTER_CLIENT_ID,
  tokens: cfg.internalSpotifyTokens || null,
  persist(tokens) {
    const c = readConfig();
    c.internalSpotifyTokens = tokens;
    writeConfig(c);
  },
});
const spotify = new InternalMetadataClient({ tokenStore });
if (tokenStore.isConnected()) {
  state.spotifyStatus = 'Spotify: connected (token cached)';
}

function tidalConfigured() {
  return !!(state.values.tidalClientId && state.values.tidalClientSecret);
}
if (tidalConfigured()) state.tidalStatus = 'Tidal ISRC lookup: enabled';

const ext = createExtension({
  onCorePaired(core) {
    state.core = core;
    ext.status.set_status(formatStatus(), false);
  },
  onCoreUnpaired() {
    state.core = null;
  },
  makeLayout() {
    return buildLayout(state);
  },
  onSettingsSaved(values, isdryrun) {
    if (!isdryrun) handleSettingsChange(values);
    state.values = { ...state.values, ...values };
    return buildLayout(state);
  },
});

function formatStatus() {
  return `${state.runStatus} • ${state.spotifyStatus} • ${state.tidalStatus}`;
}

function setStatus(s) {
  state.runStatus = s;
  if (ext.status) ext.status.set_status(formatStatus(), false);
}

// In-flight Spotify auth attempt (PKCE verifier/state kept until the user
// completes the flow, via the local callback or by pasting the code).
let pendingAuth = null;

function cancelPendingAuth() {
  if (pendingAuth && pendingAuth.server) { try { pendingAuth.server.close(); } catch (_) { /* ignore */ } }
  pendingAuth = null;
}

function startSpotifyConnect() {
  // Idempotent: keep an outstanding attempt's URL/state valid rather than
  // regenerating (Roon re-sends the "connect" dropdown value on later saves,
  // which would otherwise invalidate the PKCE state of the URL in use).
  if (pendingAuth) {
    state.spotifyStatus = `Spotify: open this URL → ${pendingAuth.authUrl}`;
    return;
  }
  const { authUrl, verifier, state: st } = beginInternalAuth();
  pendingAuth = { verifier, state: st, authUrl };
  state.spotifyStatus = `Spotify: open this URL → ${authUrl}`;
  console.log('\nAuthorize Spotify by opening this URL in any browser:\n', authUrl);
  console.log('\nAfter approving, the http://127.0.0.1:8888 page failing to load is expected.');
  console.log('Copy the whole address-bar URL (or just the code=… value) into the');
  console.log('"Paste Spotify auth code" field in Roon → Connect Spotify.\n');
  // Best-effort automatic capture for local / port-forwarded setups.
  try {
    const server = startInternalCallbackServer(st, (err, code) => {
      if (err || !code) return; // paste flow remains available
      if (pendingAuth && pendingAuth.state === st) finishSpotifyAuth(code);
    });
    pendingAuth.server = server;
  } catch (_) { /* paste flow still works */ }
}

async function finishSpotifyAuth(input) {
  if (!pendingAuth) {
    // No active attempt. Roon re-sends the pasted code on later saves; if we're
    // already connected that stale code must not downgrade the status.
    state.spotifyStatus = tokenStore.isConnected()
      ? 'Spotify: connected'
      : 'Spotify: click "Connect now" first';
  } else {
    const { code, state: gotState } = parseAuthInput(input);
    if (!code) {
      state.spotifyStatus = 'Spotify: no code found in the pasted text';
    } else if (gotState && gotState !== pendingAuth.state) {
      state.spotifyStatus = 'Spotify: state mismatch — click "Connect now" and retry';
    } else {
      try {
        const tokens = await exchangeInternalCode({ code, verifier: pendingAuth.verifier });
        tokenStore.setTokens(tokens);
        const c = readConfig(); c.internalSpotifyTokens = tokens; writeConfig(c);
        state.spotifyStatus = 'Spotify: connected';
        cancelPendingAuth();
      } catch (e) {
        state.spotifyStatus = `Spotify: auth failed — ${e.message}`;
      }
    }
  }
  if (ext.settings) ext.settings.update_settings(buildLayout(state));
  setStatus(state.runStatus);
}

async function handleSettingsChange(values) {
  const cfgNow = readConfig();

  // If the user is submitting a pasted auth code, complete that flow — don't
  // (re)start a connect in the same save, which would regenerate the PKCE state
  // and break the paste. (Roon often re-sends the "connect" dropdown value.)
  const pastingAuthCode = !!(values.spotifyAuthCode && values.spotifyAuthCode.trim());

  if (pastingAuthCode) {
    values.spotifyConnect = 'idle';
  } else if (values.spotifyConnect === 'connect') {
    startSpotifyConnect();
    values.spotifyConnect = 'idle';
  } else if (values.spotifyConnect === 'disconnect') {
    delete cfgNow.internalSpotifyTokens;
    tokenStore.setTokens(null);
    cancelPendingAuth();
    state.spotifyStatus = 'Spotify: not connected';
    values.spotifyConnect = 'idle';
  }

  cfgNow.tidalClientId = values.tidalClientId || '';
  cfgNow.tidalClientSecret = values.tidalClientSecret || '';
  cfgNow.tidalCountryCode = values.tidalCountryCode || 'US';
  state.tidalStatus =
    values.tidalClientId && values.tidalClientSecret
      ? 'Tidal ISRC lookup: enabled'
      : 'Tidal ISRC lookup: disabled';

  if (values.zone) cfgNow.zone = values.zone;
  writeConfig(cfgNow);

  // Completing Spotify auth by pasted code/URL (works when the browser is on a
  // different machine than the extension — e.g. Kubernetes). Done after
  // writeConfig so finishSpotifyAuth's token persist isn't clobbered.
  if (values.spotifyAuthCode && values.spotifyAuthCode.trim()) {
    await finishSpotifyAuth(values.spotifyAuthCode.trim());
    values.spotifyAuthCode = '';
  }

  if (values.runImport === 'start' && !state.importing) {
    values.runImport = 'idle';
    state.cancelRequested = false;
    triggerImport(values).catch((err) => {
      console.error('import failed:', err);
      setStatus(`Import failed: ${err.message}`);
      state.importing = false;
    });
  } else if (values.runImport === 'cancel') {
    state.cancelRequested = true;
    values.runImport = 'idle';
  }

  // Toggle the per-track results breakdown (matched / unmatched / errors).
  if (values.showResults === 'show') {
    state.showResults = true;
    values.showResults = 'idle';
  } else if (values.showResults === 'hide') {
    state.showResults = false;
    values.showResults = 'idle';
  }
}

async function triggerImport(values) {
  if (!spotify.isConnected()) {
    setStatus('Cannot import: Spotify not connected');
    return;
  }
  if (!values.playlistUrl) {
    setStatus('Cannot import: paste a Spotify playlist URL first');
    return;
  }
  if (!ext.roon || !state.core) {
    setStatus('Cannot import: not paired with Roon Core yet');
    return;
  }
  const browseSvc = state.core.services.RoonApiBrowse;
  if (!browseSvc) {
    setStatus('Cannot import: Roon Browse service unavailable');
    return;
  }

  state.importing = true;
  setStatus('Starting import…');

  const tidal = TidalClient.fromConfig(values);
  const zoneOrOutputId = values.zone && (values.zone.output_id || values.zone.zone_id);
  const zoneName = (values.zone && values.zone.name) || 'your zone';

  try {
    const result = await runImport({
      internalSpotify: spotify,
      tidal,
      roonBrowseSvc: browseSvc,
      zoneOrOutputId,
      playlistUrl: values.playlistUrl,
      shouldCancel: () => state.cancelRequested,
      reportDir: REPORT_DIR,
      onProgress(p) {
        if (p.phase === 'fetched') {
          setStatus(`Fetched ${p.total} tracks from "${p.name}" — importing…`);
        } else if (p.phase === 'progress') {
          setStatus(
            `Queuing ${p.index}/${p.total} → ${p.matched} queued, ${p.unmatched} unmatched, ${p.errors} errors`,
          );
        } else if (p.phase === 'cancelled') {
          setStatus(`Cancelled at ${p.index}/${p.total}`);
        } else if (p.phase === 'log') {
          console.log(p.message);
        }
      },
    });
    state.lastReport = result.report || null;
    state.lastSummary =
      `Queued ${result.matched}/${result.total} from "${result.name}" to ${zoneName} ` +
      `(${result.unmatched} unmatched, ${result.errors} errors). ` +
      `Now in Roon: open ${zoneName}'s Queue → ⋮ → Save Queue as Playlist.`;
    setStatus(state.lastSummary);
  } finally {
    state.importing = false;
    ext.settings.update_settings(buildLayout(state));
  }
}

console.log(`Spotify Playlist Importer running.
Connect Spotify in Roon → Settings → Extensions → Spotify Playlist Importer.
Local OAuth capture listens on ${INTERNAL_REDIRECT_URI} (paste-the-code works remotely).`);
