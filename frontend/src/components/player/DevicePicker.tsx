import { useTranslation } from 'react-i18next';
import { Monitor, Smartphone, X, Volume2 } from 'lucide-react';
import clsx from 'clsx';
import { usePlayerStore } from '../../store';

function DeviceIcon({ name }: { name: string }) {
  if (/iPhone|iPad|Android/i.test(name)) return <Smartphone className="w-5 h-5" />;
  return <Monitor className="w-5 h-5" />;
}

export default function DevicePicker() {
  const { t } = useTranslation();
  const {
    showDevicePicker, setShowDevicePicker,
    connectedDevices, localDeviceId, localDeviceName,
    activeDeviceId, activeDeviceName, isRemoteActive,
    claimPlaybackHere, currentTrack,
  } = usePlayerStore();

  if (!showDevicePicker) return null;

  const allDevices = connectedDevices.some((d) => d.deviceId === localDeviceId)
    ? connectedDevices
    : [{ deviceId: localDeviceId, deviceName: localDeviceName }, ...connectedDevices];

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 bg-black/60 z-[70]"
        onClick={() => setShowDevicePicker(false)}
        aria-label={t('close')}
      />
      <div className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:bottom-24 inset-x-3 md:inset-x-auto md:start-4 md:w-80 bg-[#282828] border border-white/10 rounded-xl shadow-2xl z-[71] overflow-hidden animate-slide-up">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <h3 className="font-bold text-sm">{t('playbackDevices')}</h3>
          <button type="button" onClick={() => setShowDevicePicker(false)} className="icon-btn p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {isRemoteActive && activeDeviceName && (
          <p className="px-4 py-2 text-xs text-spotify-green bg-spotify-green/10">
            {t('playingOnDevice', { device: activeDeviceName })}
          </p>
        )}

        <ul className="max-h-64 overflow-y-auto py-2">
          {allDevices.map((device) => {
            const isLocal = device.deviceId === localDeviceId;
            const isActive = device.deviceId === activeDeviceId || (!activeDeviceId && isLocal);
            return (
              <li key={device.deviceId}>
                <button
                  type="button"
                  onClick={() => {
                    if (isLocal) {
                      if (isRemoteActive) void claimPlaybackHere();
                      else setShowDevicePicker(false);
                    } else {
                      setShowDevicePicker(false);
                    }
                  }}
                  className={clsx(
                    'w-full flex items-center gap-3 px-4 py-3 text-start hover:bg-white/10 transition-colors',
                    isActive && 'text-spotify-green',
                  )}
                >
                  <DeviceIcon name={device.deviceName} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {isLocal ? t('thisDevice') : device.deviceName}
                    </p>
                    {isActive && (
                      <p className="text-2xs text-spotify-text">{t('nowPlaying')}</p>
                    )}
                  </div>
                  {isLocal && isRemoteActive && currentTrack && (
                    <span className="text-2xs font-bold text-spotify-green shrink-0">{t('listenHere')}</span>
                  )}
                  {isActive && !isRemoteActive && isLocal && (
                    <Volume2 className="w-4 h-4 shrink-0" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

/** Compact devices button for the player bar */
export function DevicePickerButton() {
  const { t } = useTranslation();
  const { setShowDevicePicker, isRemoteActive, activeDeviceName, localDeviceName } = usePlayerStore();
  const label = isRemoteActive && activeDeviceName ? activeDeviceName : localDeviceName;

  return (
    <button
      type="button"
      onClick={() => setShowDevicePicker(true)}
      className={clsx(
        'icon-btn shrink-0 flex items-center gap-1 max-w-[7rem]',
        isRemoteActive && 'text-spotify-green',
      )}
      title={t('playbackDevices')}
    >
      <Monitor className="w-4 h-4 shrink-0" />
      <span className="text-2xs truncate hidden sm:inline">{label}</span>
    </button>
  );
}
