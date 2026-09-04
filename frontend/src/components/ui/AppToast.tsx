import { useToastStore } from '../../lib/toastStore';

export default function AppToast() {
  const message = useToastStore((s) => s.message);
  if (!message) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[80] flex justify-center px-4"
      style={{ bottom: 'calc(5.5rem + env(safe-area-inset-bottom, 0px))' }}
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-none max-w-sm rounded-full bg-white/95 px-4 py-2.5 text-sm font-medium text-black shadow-lg">
        {message}
      </div>
    </div>
  );
}
