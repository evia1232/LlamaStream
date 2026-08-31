import { SearchResult } from '../services/downloader';

export interface MatchTarget {
  title: string;
  artist: string;
  duration?: number;
  album?: string;
}

export interface RankOptions {
  /** When true, reject remix/live/acoustic etc. unless the user query asked for them */
  filterVariants?: boolean;
  rawQuery?: string;
  minScore?: number;
}

/** Always reject — not the song */
const BAD_KEYWORDS = [
  'karaoke', 'cover version', 'cover by', 'tribute band', 'reaction', 'reacts to',
  'tutorial', 'lesson', 'how to play', 'full album', 'continuous mix', 'mix tape',
  'reading of', 'audiobook', 'interview', 'podcast', 'review', 'breakdown',
  'behind the scenes', 'making of', 'teaser', 'trailer',
];

/** Variant keywords — penalized/rejected unless user searched for them */
const VARIANT_PATTERNS: RegExp[] = [
  /\bremix\b/i,
  /\bre-?mix\b/i,
  /\bedm remix\b/i,
  /\bdj mix\b/i,
  /\bmashup\b/i,
  /\bbootleg\b/i,
  /\bflip\b/i,
  /\bvip mix\b/i,
  /\bclub mix\b/i,
  /\bextended mix\b/i,
  /\bextended version\b/i,
  /\bradio edit\b/i,
  /\blive\b/i,
  /\blive at\b/i,
  /\blive from\b/i,
  /\bconcert\b/i,
  /\bperformance\b/i,
  /\bacoustic\b/i,
  /\bunplugged\b/i,
  /\bcover\b/i,
  /\bslowed\b/i,
  /\bslowed\s*\+\s*reverb\b/i,
  /\breverb\b/i,
  /\b8d audio\b/i,
  /\b8d\b/i,
  /\bnightcore\b/i,
  /\bsped up\b/i,
  /\bspeed up\b/i,
  /\bpitch shifted\b/i,
  /\binstrumental\b/i,
  /\bpiano cover\b/i,
  /\bguitar cover\b/i,
  /\bdemo\b/i,
  /\bouttake\b/i,
  /\balternate version\b/i,
  /\balternative version\b/i,
  /\bvisualizer\b/i,
  /\blyrics video\b/i,
  /\blyric video\b/i,
];

const GOOD_KEYWORDS = [
  'official audio',
  'official video',
  'official music video',
  'provided to youtube',
  'topic',
  'vevo',
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

/** Returns variant patterns found in text */
export function findVariants(text: string): RegExp[] {
  return VARIANT_PATTERNS.filter((p) => p.test(text));
}

/** User explicitly searched for a variant (remix, live, etc.) */
export function userRequestedVariant(...texts: (string | undefined)[]): boolean {
  const combined = texts.filter(Boolean).join(' ');
  return findVariants(combined).length > 0;
}

/** YouTube title has a variant the user did NOT ask for */
export function hasUnwantedVariant(
  ytTitle: string,
  targetTitle: string,
  rawQuery?: string
): boolean {
  if (userRequestedVariant(rawQuery, targetTitle)) return false;

  const ytVariants = findVariants(ytTitle);
  if (ytVariants.length === 0) return false;

  const targetText = targetTitle;
  return ytVariants.some((pattern) => pattern.test(ytTitle) && !pattern.test(targetText));
}

export function isLikelyBadMatch(title: string): boolean {
  const lower = title.toLowerCase();
  return BAD_KEYWORDS.some((kw) => lower.includes(kw));
}

export function scoreYouTubeMatch(result: SearchResult, target: MatchTarget, options?: RankOptions): number {
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
    else if (diff > 90) score -= 30;
    if (result.duration > target.duration * 1.6) score -= 40;
    if (result.duration < target.duration * 0.45) score -= 30;
  }

  // Keyword bonuses
  for (const kw of GOOD_KEYWORDS) {
    if (ytCombined.includes(kw)) score += 10;
  }

  // Penalties
  if (isLikelyBadMatch(ytTitle)) score -= 80;

  const variants = findVariants(ytTitle);
  const userWantsVariant = userRequestedVariant(options?.rawQuery, target.title);
  if (variants.length > 0 && !userWantsVariant) {
    const unwanted = variants.filter((p) => p.test(ytTitle) && !p.test(target.title));
    score -= unwanted.length * 45;
  }

  // Extra artist on YT not in target (often cover channels / remix artists)
  if (target.artist && result.artist) {
    const ytArtistNorm = normalizeForMatch(result.artist);
    if (targetArtist && !ytArtistNorm.includes(targetArtist) && wordOverlap(target.artist, result.artist) < 0.3) {
      score -= 25;
    }
  }

  return score;
}

export function rankYouTubeResults(
  results: SearchResult[],
  target: MatchTarget,
  options?: RankOptions
): SearchResult[] {
  const minScore = options?.minScore ?? (options?.filterVariants ? 35 : 15);
  const filterVariants = options?.filterVariants ?? false;

  return [...results]
    .map((r) => ({ result: r, score: scoreYouTubeMatch(r, target, options) }))
    .filter(({ result, score }) => {
      if (score < minScore) return false;
      if (isLikelyBadMatch(result.title)) return false;
      if (filterVariants && hasUnwantedVariant(result.title, target.title, options?.rawQuery)) {
        console.log(`[Match] Skipped variant: "${result.title}"`);
        return false;
      }
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.result);
}

export function buildSearchQueries(artist: string, title: string, album?: string): string[] {
  const a = primaryArtist(artist);
  // Prefer studio/official versions in search queries
  const queries = [
    `${a} ${title} official audio`,
    `${a} - ${title} official`,
    `"${a}" "${title}" official audio`,
    `${a} - ${title}`,
    `${a} ${title}`,
  ];
  if (album) {
    queries.push(`${a} ${title} ${album} official`);
  }
  return [...new Set(queries.filter(Boolean))];
}

/** Whether to apply strict variant filtering for this download request */
export function shouldFilterVariants(
  rawInput: string,
  opts?: { title?: string; artist?: string }
): boolean {
  if (userRequestedVariant(rawInput, opts?.title)) return false;
  // Structured metadata from Spotify/import → want original studio version
  if (opts?.title && opts?.artist) return true;
  return false;
}
