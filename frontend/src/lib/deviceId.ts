const DEVICE_ID_KEY = 'llamastream_device_id';

export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return 'local-device';
  }
}

export function getDeviceName(): string {
  if (typeof navigator === 'undefined') return 'Browser';
  const ua = navigator.userAgent;
  const platform = navigator.platform || '';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows/i.test(ua) || /Win/i.test(platform)) return 'Windows';
  if (/Mac/i.test(ua) || /Mac/i.test(platform)) return 'Mac';
  if (/Linux/i.test(platform)) return 'Linux';
  return 'Browser';
}

export function isLocalDeviceActive(activeDeviceId: string | null, localDeviceId: string): boolean {
  return !activeDeviceId || activeDeviceId === localDeviceId;
}
