import { useTranslation } from 'react-i18next';
import { isRtlLanguage } from '../lib/direction';

export function useDirection() {
  const { i18n } = useTranslation();
  const isRtl = isRtlLanguage(i18n.language);
  return { isRtl, dir: isRtl ? ('rtl' as const) : ('ltr' as const) };
}
