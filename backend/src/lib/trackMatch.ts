import { SearchResult } from '../services/downloader';

export interface MatchTarget {
  title: string;
  artist: string;
  duration?: number;
  album?: string;
}

const BAD_KEYWORDS = [
  'karaoke', 'cover version', 'cover by', 'tribute', 'reaction', 'reacts to',
  'tutorial', 'lesson', 'how to play', 'slowed', 'reverb', '8d audio', 'nightcore',
  'bass boosted', 'chipmunk', 'instrumental only', 'piano cover', 'guitar cover',
  'full album', 'continuous mix', 'mix tape', 'reading of', 'audiobook',
];

const GOOD_KEYWORDS = [
  'official audio', 'official video', 'official music video',
  'provided to youtube', 'topic', 'vevo',
];

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^\w\s\u0590-\u05ff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function primaryArtist(artist: string): string {
  return artist.split(/[,;&]| feat\.?| ft\.?| featuring /i)[0].trim();
}

function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(normalizeForMatch(a).split(' ').filter((w) => w.length > 1));
  const wordsB = new Set(normalizeForMatch(b).split(' ').filter((w) => w.length > 1));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let shared = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) shared++;
  }
  return shared / Math.max(wordsA.size, wordsB.size);
}

export function isLikelyBadMatch(title: string): boolean {
  const lower = title.toLowerCase();
  return BAD_KEYWORDS.some((kw) => lower.includes(kw));
}

export function scoreYouTubeMatch(result: SearchResult, target: MatchTarget): number {
  const ytTitle = result.title;
  const ytCombined = `${result.artist} ${ytTitle}`.toLowerCase();
  const targetTitle = normalizeForMatch(target.title);
  const targetArtist = normalizeForMatch(primaryArtist(target.artist));
  const normYtTitle = normalizeForMatch(ytTitle);

  let score = 0;

  // Title similarity
  if (normYtTitle.includes(targetTitle) || targetTitle.includes(normYtTitle)) {
    score += 45;
  } else {
    score += Math.round(wordOverlap(target.title, ytTitle) * 35);
  }

  // Artist presence
  if (targetArtist && (normYtTitle.includes(targetArtist) || normalizeForMatch(result.artist).includes(targetArtist))) {
    score += 30;
  } else {
    score += Math.round(wordOverlap(target.artist, result.artist) * 20);
  }

  // Duration match (Spotify gives seconds)
  if (target.duration && target.duration > 0 && result.duration > 0) {
    const diff = Math.abs(result.duration - target.duration);
    if (diff <= 10) score += 30;
    else if (diff <= 20) score += 22;
    else if (diff <= 45) score += 10;
    else if (diff > 90) score -= 25;
    if (result.duration > target.duration * 1.8) score -= 35;
    if (result.duration < target.duration * 0.4) score -= 25;
  }

  // Keyword bonuses / penalties
  for (const kw of GOOD_KEYWORDS) {
    if (ytCombined.includes(kw)) score += 8;
  }
  if (isLikelyBadMatch(ytTitle)) score -= 60;

  return score;
}

export function rankYouTubeResults(results: SearchResult[], target: MatchTarget): SearchResult[] {
  return [...results]
    .map((r) => ({ result: r, score: scoreYouTubeMatch(r, target) }))
    .sort((a, b) => b.score - a.score)
    .filter((x) => x.score > 15)
    .map((x) => x.result);
}

export function buildSearchQueries(artist: string, title: string, album?: string): string[] {
  const a = primaryArtist(artist);
  const queries = [
    `${a} ${title} official audio`,
    `${a} - ${title}`,
    `${a} ${title}`,
    `"${a}" "${title}"`,
  ];
  if (album) {
    queries.push(`${a} ${title} ${album}`);
  }
  return [...new Set(queries.filter(Boolean))];
}
