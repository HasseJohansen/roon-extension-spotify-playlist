'use strict';

const fs = require('fs');
const path = require('path');

const { fetchPlaylist } = require('./spotify/playlist');
const { matchTrack } = require('./match/pipeline');
const { RoonBrowser } = require('./roon/browse');

async function runImport({
  spotifyTokens,
  tidal,
  roonBrowseSvc,
  zoneOrOutputId,
  playlistUrl,
  targetName,
  onProgress,
  shouldCancel,
  reportDir,
}) {
  const playlist = await fetchPlaylist(spotifyTokens, playlistUrl);
  const name = targetName && targetName.trim() ? targetName.trim() : playlist.name;
  const total = playlist.tracks.length;

  onProgress({ phase: 'fetched', total, name });

  const browser = new RoonBrowser(roonBrowseSvc, { zoneOrOutputId });

  const report = [];
  const unmatched = [];
  let matched = 0;
  let errors = 0;
  let createdPlaylist = false;

  for (let i = 0; i < total; i++) {
    if (shouldCancel && shouldCancel()) {
      onProgress({ phase: 'cancelled', index: i, total, matched, unmatched: unmatched.length, errors });
      break;
    }
    const track = playlist.tracks[i];
    const ctx = `${i + 1}/${total} "${track.title}" / ${track.artists[0] || ''}`;
    try {
      const match = await matchTrack({
        spotifyTrack: track,
        tidal,
        roonSearch: async (query) => {
          const root = await browser.search(query);
          const tracksList = await browser.openTracksList(root);
          return tracksList.map((it) => RoonBrowser.itemToCandidate(it));
        },
        log: (msg) => onProgress({ phase: 'log', message: `${ctx}: ${msg}` }),
      });

      if (!match) {
        unmatched.push({ ...track, reason: 'no candidate above threshold' });
        report.push({ index: i + 1, spotify: track, matched: false });
        onProgress({ phase: 'progress', index: i + 1, total, matched, unmatched: unmatched.length, errors, name, message: `unmatched: ${ctx}` });
        continue;
      }

      await browser.addTrackToPlaylist({
        trackItemKey: match.candidate.itemKey,
        playlistName: name,
        createNew: !createdPlaylist,
      });
      createdPlaylist = true;
      matched++;
      report.push({
        index: i + 1,
        spotify: track,
        matched: true,
        tier: match.tier,
        confidence: match.confidence,
        roon: { title: match.candidate.title, artist: match.candidate.artist, album: match.candidate.album },
      });
      onProgress({ phase: 'progress', index: i + 1, total, matched, unmatched: unmatched.length, errors, name, message: `T${match.tier} ${ctx}` });
    } catch (err) {
      errors++;
      report.push({ index: i + 1, spotify: track, matched: false, error: err.message });
      onProgress({ phase: 'progress', index: i + 1, total, matched, unmatched: unmatched.length, errors, name, message: `error: ${ctx} → ${err.message}` });
    }
  }

  if (reportDir) {
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, 'match-report.json'), JSON.stringify({ playlist: name, report }, null, 2));
    if (unmatched.length) {
      const lines = unmatched.map(
        (t) => `${t.title}\t${t.artists.join(', ')}\t${t.album || ''}\t${t.isrc || ''}\t${t.spotifyUrl || ''}`,
      );
      fs.writeFileSync(path.join(reportDir, 'unmatched.log'), lines.join('\n') + '\n');
    }
  }

  return { name, total, matched, unmatched: unmatched.length, errors };
}

module.exports = { runImport };
