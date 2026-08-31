export function getLanguage(): string {
  return localStorage.getItem('language') || document.documentElement.lang || 'he';
}

export function isRtlLanguage(lang?: string): boolean {
  const code = (lang || getLanguage()).toLowerCase();
  return code === 'he' || code.startsWith('he-') || code === 'ar' || code.startsWith('ar-');
}

export function applyDocumentDirection(lang?: string): void {
  const code = lang || getLanguage();
  const rtl = isRtlLanguage(code);
  document.documentElement.lang = code;
  document.documentElement.dir = rtl ? 'rtl' : 'ltr';
}

export function progressGradient(pct: number): string {
  // Seek bars always fill left→right (matches Spotify) regardless of page direction
  return `linear-gradient(to right, #fff ${pct}%, #4d4d4d ${pct}%)`;
}
