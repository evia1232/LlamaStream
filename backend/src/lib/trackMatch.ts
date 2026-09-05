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
  'karaoke', 'karaoke version', 'sing along', 'sing-along', 'singalong',
  'with lyrics', 'lyrics on screen', 'scrolling lyrics', 'lyric video', 'lyrics video',
  'cover version', 'cover by', 'tribute band', 'tribute to', 'in the style of',
  'backing track', 'backtrack', 'playback track', 'minus one', 'minusone', 'no vocals',
  'instrumental karaoke', 'pro backing', 'originally performed by',
  'reaction', 'reacts to', 'tutorial', 'lesson', 'how to play', 'guitar tutorial',
  'piano tutorial', 'bass cover', 'drum cover', 'full album', 'continuous mix',
  'mix tape', 'reading of', 'audiobook', 'interview', 'podcast', 'review', 'breakdown',
  'behind the scenes', 'making of', 'teaser', 'trailer', 'fan made', 'fanmade',
  '8d audio', 'nightcore', 'chipmunk', 'sped up', 'slowed reverb', 'bass boosted',
  'phonk', 'tiktok version', 'tik tok version',
  '#shorts', 'youtube shorts', ' yt shorts', '/shorts/',
  'reels', 'reel', 'instagram reel',
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
  /\bacoustic version\b/i,
  /\bacoustic cover\b/i,
  /\bunplugged\b/i,
  /\bpiano cover\b/i,
  /\bguitar cover\b/i,
  /\bviolin cover\b/i,
  /\bcover by\b/i,
  /\bcover version\b/i,
  /\bcovered by\b/i,
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
  return sanitizeSearchText(artist).split(/[,;&]| feat\.?| ft\.?| featuring /i)[0].trim();
}

export function sanitizeSearchText(s: string): string {
  return s
    .replace(/\u00a0/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Clean titles like "תנטוספליפ_79_בונוס" for search */
export function cleanSearchTitle(title: string): string {
  return sanitizeSearchText(title)
    .replace(/\s*[\(\[\{].*?[\)\]\}]\s*/g, ' ')
    .replace(/\b(bonus|בונוס|remaster(ed)?|radio\s*edit)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function containsHebrew(s: string): boolean {
  return /[\u0590-\u05FF]/.test(s);
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

/** "Artist - Title" / "Artist | Title" from YouTube upload titles */
export function extractLeadingArtistFromYouTubeTitle(title: string): string | null {
  const match = title.match(/^(.+?)\s[-–—|]\s(.+)$/);
  if (!match) return null;
  const leading = match[1].trim();
  // Avoid treating "Official Audio" style prefixes as artists
  if (/^(official|lyrics?|audio|video|hd|4k|mv)\b/i.test(leading)) return null;
  if (leading.length < 2 || leading.length > 80) return null;
  return leading;
}

/** How well does the YouTube result identify as the target artist? 0..1 */
export function artistMatchStrength(
  result: Pick<SearchResult, 'title' | 'artist'>,
  targetArtistRaw: string,
): number {
  const targetArtist = normalizeForMatch(primaryArtist(targetArtistRaw));
  if (!targetArtist || targetArtist.length < 2) return 1; // no artist to enforce

  const ytChannel = normalizeForMatch(result.artist || '');
  const ytTitle = normalizeForMatch(result.title || '');
  const leading = extractLeadingArtistFromYouTubeTitle(result.title || '');
  const leadingNorm = leading ? normalizeForMatch(leading) : '';

  if (ytTitle.includes(targetArtist) || ytChannel.includes(targetArtist)) return 1;
  if (leadingNorm && (leadingNorm.includes(targetArtist) || targetArtist.includes(leadingNorm))) return 1;

  const channelOverlap = wordOverlap(targetArtistRaw, result.artist || '');
  const leadingOverlap = leading ? wordOverlap(targetArtistRaw, leading) : 0;
  const titleOverlap = wordOverlap(targetArtistRaw, result.title || '');
  return Math.max(channelOverlap, leadingOverlap, titleOverlap * 0.5);
}

/** Clear wrong-artist case: title matches song, but YT names a different lead artist */
export function isWrongArtistMatch(
  result: Pick<SearchResult, 'title' | 'artist'>,
  target: MatchTarget,
): boolean {
  const targetArtist = primaryArtist(target.artist);
  if (!targetArtist || targetArtist.length < 2) return false;

  const targetTitle = normalizeForMatch(cleanSearchTitle(target.title));
  if (targetTitle.length < 2) return false;

  const strength = artistMatchStrength(result, targetArtist);
  if (strength >= 0.35) return false;

  const ytTitle = normalizeForMatch(result.title);
  const titleHit =
    ytTitle.includes(targetTitle)
    || targetTitle.includes(extractTrackTitleFromYouTube(result.title).toLowerCase().replace(/[^\w\s\u0590-\u05ff]/g, ' ').replace(/\s+/g, ' ').trim())
    || wordOverlap(target.title, extractTrackTitleFromYouTube(result.title)) >= 0.6;

  if (!titleHit) return false;

  // Latin Spotify artist + Hebrew YouTube lead artist (or any distinct lead) → wrong song
  const leading = extractLeadingArtistFromYouTubeTitle(result.title);
  if (leading && wordOverlap(targetArtist, leading) < 0.25 && artistMatchStrength(result, targetArtist) < 0.35) {
    return true;
  }

  // Channel/uploader clearly different and no artist tokens in title
  if (result.artist && wordOverlap(targetArtist, result.artist) < 0.2 && strength < 0.2) {
    return true;
  }

  return strength < 0.15;
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

export function extractTrackTitleFromYouTube(title: string): string {
  const match = title.match(/^(.+?)\s[-–—]\s(.+)$/);
  if (match) return match[2].trim();
  return title
    .replace(/\s*[\(\[\{](official\s*(video|audio|lyric(s)?|visualizer)|lyrics?|audio|video|hd|4k|visual|prod\.?)[^)\]\}]*[\)\]\}]/gi, '')
    .trim();
}

export function isYouTubeShortOrReel(result: Pick<SearchResult, 'url' | 'title' | 'duration'>): boolean {
  const url = (result.url || '').toLowerCase();
  if (url.includes('/shorts/')) return true;

  const title = result.title || '';
  const lower = title.toLowerCase();
  if (/#shorts\b/i.test(title)) return true;
  if (/\byoutube\s+shorts?\b/i.test(lower)) return true;
  if (/\breels?\b/i.test(lower)) return true;
  if (/\bshorts\b/i.test(lower) && result.duration > 0 && result.duration <= 90) return true;
  if (/\btiktok\b/i.test(lower)) return true;

  if (result.duration > 0 && result.duration <= 45) return true;

  return false;
}

export function durationDiffSeconds(targetDuration?: number, resultDuration?: number): number | null {
  if (!targetDuration || targetDuration <= 0 || !resultDuration || resultDuration <= 0) return null;
  return Math.abs(resultDuration - targetDuration);
}

/** Spotify duration vs YouTube result — reject reels/clips and bad length matches */
export function isDurationCompatible(
  targetDuration?: number,
  resultDuration?: number,
  relaxed = false
): boolean {
  if (!targetDuration || targetDuration <= 0) return true;
  if (!resultDuration || resultDuration <= 0) return false;

  const diff = Math.abs(resultDuration - targetDuration);
  const maxDiff = relaxed ? 75 : 50;

  if (targetDuration >= 90 && resultDuration <= 60) return false;
  if (targetDuration >= 150 && resultDuration <= 90) return false;
  if (diff > maxDiff) return false;
  if (resultDuration < targetDuration * (relaxed ? 0.42 : 0.55)) return false;
  if (resultDuration > targetDuration * (relaxed ? 2 : 1.8)) return false;

  return true;
}

export function isRejectedYouTubeResult(
  result: SearchResult,
  target: MatchTarget,
  relaxed = false
): boolean {
  if (isYouTubeShortOrReel(result)) return true;
  if (isLikelyBadMatch(result.title)) return true;

  if (target.duration && target.duration > 0 && result.duration > 0) {
    if (!isDurationCompatible(target.duration, result.duration, relaxed)) return true;
  } else if (target.duration && target.duration >= 90 && result.duration > 0 && result.duration <= 60) {
    return true;
  }

  // Never accept a clear wrong-artist hit when we know who we want
  if (!relaxed && isWrongArtistMatch(result, target)) return true;

  return false;
}

export function filterYouTubeResults(
  results: SearchResult[],
  target: MatchTarget,
  relaxed = false
): SearchResult[] {
  return results.filter((r) => !isRejectedYouTubeResult(r, target, relaxed));
}

export function isLikelyBadMatch(title: string): boolean {
  const lower = title.toLowerCase();
  if (BAD_KEYWORDS.some((kw) => lower.includes(kw))) return true;
  if (/\bkaraoke\b/i.test(lower)) return true;
  if (/\bsing\s*along\b/i.test(lower)) return true;
  if (/\bקאבר\b/.test(title)) return true;
  if (/\bכיסוי\b/.test(title)) return true;
  return false;
}

export function scoreYouTubeMatch(result: SearchResult, target: MatchTarget, options?: RankOptions): number {
  const ytTitle = result.title;
  const ytCombined = `${result.artist} ${ytTitle}`.toLowerCase();
  const targetTitle = normalizeForMatch(cleanSearchTitle(target.title));
  const targetArtist = normalizeForMatch(primaryArtist(target.artist));
  const normYtTitle = normalizeForMatch(ytTitle);
  const extractedYtTitle = normalizeForMatch(extractTrackTitleFromYouTube(ytTitle));
  const titleMatches =
    normYtTitle.includes(targetTitle)
    || targetTitle.includes(normYtTitle)
    || extractedYtTitle.includes(targetTitle)
    || targetTitle.includes(extractedYtTitle);

  let score = 0;

  // Title similarity
  if (titleMatches) {
    score += 45;
  } else {
    score += Math.round(Math.max(
      wordOverlap(target.title, ytTitle),
      wordOverlap(target.title, extractTrackTitleFromYouTube(ytTitle)),
    ) * 35);
  }

  // Artist — required signal; never invent credit for Hebrew title-only hits
  const artistStrength = artistMatchStrength(result, target.artist);
  if (targetArtist) {
    if (artistStrength >= 0.7) score += 40;
    else if (artistStrength >= 0.35) score += 22;
    else if (artistStrength >= 0.15) score += 5;
    else score -= 55;

    if (isWrongArtistMatch(result, target)) {
      score -= 90;
    }
  }

  // Duration match (Spotify gives seconds) — heavily weighted
  if (target.duration && target.duration > 0 && result.duration > 0) {
    const diff = Math.abs(result.duration - target.duration);
    if (diff <= 8) score += 45;
    else if (diff <= 15) score += 35;
    else if (diff <= 25) score += 25;
    else if (diff <= 45) score += 10;
    else score -= 50;
    if (result.duration > target.duration * 1.6) score -= 50;
    if (result.duration < target.duration * 0.5) score -= 60;
    if (target.duration >= 90 && result.duration <= 60) score -= 100;
  } else if (target.duration && target.duration >= 90 && result.duration > 0 && result.duration <= 60) {
    score -= 100;
  }

  if (isYouTubeShortOrReel(result)) score -= 150;

  for (const kw of GOOD_KEYWORDS) {
    if (ytCombined.includes(kw)) score += 10;
  }

  if (isLikelyBadMatch(ytTitle)) score -= 80;

  const variants = findVariants(ytTitle);
  const userWantsVariant = userRequestedVariant(options?.rawQuery, target.title);
  if (variants.length > 0 && !userWantsVariant) {
    const unwanted = variants.filter((p) => p.test(ytTitle) && !p.test(target.title));
    score -= unwanted.length * 45;
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
  const hasArtist = normalizeForMatch(primaryArtist(target.artist || '')).length >= 2;

  return [...results]
    .filter((r) => !isRejectedYouTubeResult(r, target, false))
    .map((r) => ({ result: r, score: scoreYouTubeMatch(r, target, options) }))
    .filter(({ result, score }) => {
      if (score < minScore) return false;
      if (isLikelyBadMatch(result.title)) return false;
      if (isYouTubeShortOrReel(result)) return false;
      if (hasArtist && isWrongArtistMatch(result, target)) return false;
      if (hasArtist && artistMatchStrength(result, target.artist) < 0.15 && score < 70) return false;
      if (target.duration && target.duration > 0 && result.duration > 0
        && !isDurationCompatible(target.duration, result.duration, false)) {
        return false;
      }
      if (filterVariants && hasUnwantedVariant(result.title, target.title, options?.rawQuery)) {
        console.log(`[Match] Skipped variant: "${result.title}"`);
        return false;
      }
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.result);
}

export function pickBestAvailableResult(
  results: SearchResult[],
  target: MatchTarget,
  options?: RankOptions
): SearchResult | null {
  if (results.length === 0) return null;

  const ranked = rankYouTubeResults(results, target, options);
  if (ranked.length > 0) return ranked[0];

  const hasArtist = normalizeForMatch(primaryArtist(target.artist || '')).length >= 2;
  const normTitle = normalizeForMatch(cleanSearchTitle(target.title));
  const safe = results.filter((r) => !isLikelyBadMatch(r.title) && !isYouTubeShortOrReel(r)
    && !isRejectedYouTubeResult(r, target, !!options?.minScore && options.minScore <= 18)
    && !(hasArtist && isWrongArtistMatch(r, target)));

  for (const r of safe) {
    const ytNorm = normalizeForMatch(r.title);
    if (normTitle.length >= 3 && (ytNorm.includes(normTitle) || normTitle.includes(ytNorm))) {
      if (hasArtist && artistMatchStrength(r, target.artist) < 0.2) continue;
      if (!hasUnwantedVariant(r.title, target.title, options?.rawQuery)) return r;
    }
  }

  const relaxed = rankYouTubeResults(safe, target, {
    ...options,
    filterVariants: true,
    minScore: 12,
  });
  return relaxed[0] ?? null;
}

export function buildSearchQueries(artist: string, title: string, album?: string): string[] {
  const a = sanitizeSearchText(primaryArtist(artist));
  const t = cleanSearchTitle(title);
  const rawTitle = sanitizeSearchText(title);
  const queries: string[] = [];

  // Always prefer artist+title first — bare title finds the wrong popular song
  // (e.g. מחילה → אבישי אשל instead of JASMIN MOALLEM)
  if (a && t) {
    queries.push(`${a} ${t}`);
    queries.push(`${a} - ${t}`);
    queries.push(`${t} ${a}`);
    queries.push(`"${a}" "${t}"`);
    queries.push(`${a} ${t} official audio`);
    queries.push(`${a} - ${t} official audio`);
  }

  if (containsHebrew(t) || containsHebrew(a) || containsHebrew(rawTitle)) {
    if (rawTitle !== t && a) queries.push(`${a} ${rawTitle}`);
    if (album && t) queries.push(`${a} ${t} ${sanitizeSearchText(album)}`.trim());
    // Title-only only as late fallback when artist searches fail
    if (t) queries.push(`${t} audio`);
  }

  queries.push(
    `${a} ${t} official audio`,
    `${a} - ${t} official`,
    `"${a}" "${t}" official audio`,
    `${a} - ${t}`,
    `${a} ${t}`,
  );
  if (album) {
    queries.push(`${a} ${t} ${sanitizeSearchText(album)} official`);
  }
  // Bare title last — never first
  if (t) queries.push(t);
  if (rawTitle && rawTitle !== t) queries.push(rawTitle);

  return [...new Set(queries.filter((q) => q && q.replace(/["']/g, '').trim().length > 0))];
}

/** Whether to apply strict variant filtering for this download request */
export function shouldFilterVariants(
  rawInput: string,
  opts?: { title?: string; artist?: string }
): boolean {
  if (userRequestedVariant(rawInput, opts?.title, opts?.artist)) return false;
  return true;
}
