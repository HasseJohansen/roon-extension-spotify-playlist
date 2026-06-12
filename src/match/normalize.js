'use strict';

const DECORATOR_PATTERNS = [
  /\(feat\.?[^)]*\)/gi,
  /\[feat\.?[^\]]*\]/gi,
  /\bfeat\.?\s+[^,\-(]+/gi,
  /\(featuring[^)]*\)/gi,
  /\(with[^)]*\)/gi,
  /\(remaster(?:ed)?(?:\s+\d{4})?\)/gi,
  /\[remaster(?:ed)?(?:\s+\d{4})?\]/gi,
  /-\s*remaster(?:ed)?(?:\s+\d{4})?\s*$/gi,
  /\(\d{4}\s+remaster(?:ed)?\)/gi,
  /\(live(?:\s+at[^)]*)?\)/gi,
  /\[live(?:\s+at[^\]]*)?\]/gi,
  /\(deluxe(?:\s+edition)?\)/gi,
  /\(bonus\s+track[^)]*\)/gi,
  /\[bonus\s+track[^\]]*\]/gi,
  /\(explicit\)/gi,
  /\(clean\)/gi,
  /\(radio\s+edit\)/gi,
  /\(single\s+version\)/gi,
  /\(album\s+version\)/gi,
  /\(mono\s+version\)/gi,
  /\(stereo\s+version\)/gi,
  /\(extended(?:\s+version|\s+mix)?\)/gi,
  /\s*-\s*from\s+["“][^"”]*["”]\s*$/gi,
];

function stripDiacritics(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function strip(input) {
  if (input == null) return '';
  let s = String(input);
  for (const re of DECORATOR_PATTERNS) s = s.replace(re, ' ');
  return s.trim();
}

function normalize(input) {
  if (input == null) return '';
  let s = strip(String(input));
  s = stripDiacritics(s).toLowerCase();
  s = s.replace(/[’']/g, '');
  s = s.replace(/&/g, ' and ');
  s = s.replace(/[^a-z0-9]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

// Reduce a title to its core: strip known decorators, then drop any remaining
// parenthetical (e.g. "(En Inciterende Flamenco)") and any " - <suffix>" tail
// (e.g. "- The Disco Boys Edit", "- 1995 - Remaster"). Used both to build a
// forgiving Roon search query and for relaxed title comparison.
function baseTitle(input) {
  let s = strip(String(input == null ? '' : input));
  s = s.replace(/\s*\([^)]*\)\s*/g, ' ');
  s = s.replace(/\s+-\s+.*$/, '');
  return s.replace(/\s+/g, ' ').trim();
}

function primaryArtist(artistField) {
  if (!artistField) return '';
  if (Array.isArray(artistField)) {
    return artistField[0] && (artistField[0].name || artistField[0]);
  }
  const first = String(artistField).split(/\s*(?:,|&|\bfeat\.?\b|\bft\.?\b|\band\b)\s*/i)[0];
  return first || '';
}

module.exports = { strip, normalize, stripDiacritics, primaryArtist, baseTitle };
