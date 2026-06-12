'use strict';

const fs = require('fs');
const path = require('path');

const { createExtension } = require('./roon/extension');
const { buildLayout } = require('./roon/settings');
const { beginAuth, parseAuthInput, startCallbackServer, exchangeCodeForTokens, SpotifyTokenStore, REDIRECT_URI } = require('./spotify/auth');
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
    spotifyClientId: cfg.spotifyClientId || '',
    spotifyConnect: 'idle',
    spotifyAuthCode: '',
    tidalClientId: cfg.tidalClientId || '',
    tidalClientSecret: cfg.tidalClientSecret || '',
    tidalCountryCode: cfg.tidalCountryCode || 'US',
    playlistUrl: '',
    targetName: '',
    zone: cfg.zone || null,
    runImport: 'idle',
  },
  spotifyStatus: 'Spotify: not connected',
  tidalStatus: 'Tidal ISRC lookup: disabled',
  runStatus: 'Idle',
  lastSummary: '',
  cancelRequested: false,
  importing: false,
};

const tokenStore = new SpotifyTokenStore({
  clientId: cfg.spotifyClientId || '',
  tokens: cfg.spotifyTokens || null,
  persist(tokens) {
    const c = readConfig();
    c.spotifyTokens = tokens;
    writeConfig(c);
  },
});

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

function startSpotifyConnect(clientId) {
  cancelPendingAuth();
  const { authUrl, verifier, state: st } = beginAuth(clientId);
  pendingAuth = { verifier, state: st, clientId };
  state.spotifyStatus = `Spotify: open this URL → ${authUrl}`;
  console.log('\nAuthorize Spotify by opening this URL in any browser:\n', authUrl);
  console.log('\nAfter approving, the http://127.0.0.1:8888 page failing to load is expected.');
  console.log('Copy the whole address-bar URL (or just the code=… value) into the');
  console.log('"Paste Spotify auth code" field in Roon → Connect Spotify.\n');
  // Best-effort automatic capture for local / port-forwarded setups.
  try {
    const server = startCallbackServer(st, (err, code) => {
      if (err || !code) return; // paste flow remains available
      if (pendingAuth && pendingAuth.state === st) finishSpotifyAuth(code);
    });
    pendingAuth.server = server;
  } catch (_) { /* paste flow still works */ }
}

async function finishSpotifyAuth(input) {
  if (!pendingAuth) {
    state.spotifyStatus = 'Spotify: click "Connect now" first';
  } else {
    const { code, state: gotState } = parseAuthInput(input);
    if (!code) {
      state.spotifyStatus = 'Spotify: no code found in the pasted text';
    } else if (gotState && gotState !== pendingAuth.state) {
      state.spotifyStatus = 'Spotify: state mismatch — click "Connect now" and retry';
    } else {
      try {
        const tokens = await exchangeCodeForTokens({ clientId: pendingAuth.clientId, code, verifier: pendingAuth.verifier });
        tokenStore.setTokens(tokens);
        const c = readConfig(); c.spotifyTokens = tokens; writeConfig(c);
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
  const newClientId = values.spotifyClientId || '';
  if (newClientId !== state.values.spotifyClientId) {
    cfgNow.spotifyClientId = newClientId;
    tokenStore.clientId = newClientId;
  }

  if (values.spotifyConnect === 'connect') {
    if (!newClientId) {
      state.spotifyStatus = 'Spotify: enter Client ID first';
    } else {
      startSpotifyConnect(newClientId);
    }
    values.spotifyConnect = 'idle';
  } else if (values.spotifyConnect === 'disconnect') {
    delete cfgNow.spotifyTokens;
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
}

async function triggerImport(values) {
  if (!tokenStore.isConnected()) {
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
  console.log(`\nSpotify redirect URI must be registered as: ${REDIRECT_URI}`);

  const tidal = TidalClient.fromConfig(values);
  const zoneOrOutputId = values.zone && (values.zone.output_id || values.zone.zone_id);
  const zoneName = (values.zone && values.zone.name) || 'your zone';

  try {
    const result = await runImport({
      spotifyTokens: tokenStore,
      tidal,
      roonBrowseSvc: browseSvc,
      zoneOrOutputId,
      playlistUrl: values.playlistUrl,
      targetName: values.targetName,
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
Spotify redirect URI to register: ${REDIRECT_URI}
Open Roon → Settings → Extensions → Spotify Playlist Importer.`);
