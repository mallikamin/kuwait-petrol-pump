import { useEffect, useState } from 'react';

const OLD_HOST = 'kuwaitpos.duckdns.org';
const NEW_URL = 'https://fuelpos.sitaratech.info';
const DISPLAY_MS = 10000;
const FADE_MS = 800;

type Phase = 'visible' | 'fading' | 'hidden';

export function DomainMigrationBanner() {
  const [phase, setPhase] = useState<Phase>('hidden');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.hostname !== OLD_HOST) return;

    setPhase('visible');
    const fadeTimer = setTimeout(() => setPhase('fading'), DISPLAY_MS);
    const hideTimer = setTimeout(() => setPhase('hidden'), DISPLAY_MS + FADE_MS);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, []);

  if (phase === 'hidden') return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        padding: '12px 16px',
        background: '#fef3c7',
        color: '#92400e',
        borderBottom: '2px solid #f59e0b',
        textAlign: 'center',
        fontSize: '14px',
        fontWeight: 500,
        boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
        opacity: phase === 'fading' ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease-out`,
        pointerEvents: phase === 'fading' ? 'none' : 'auto',
      }}
    >
      Please use the new link going forward:{' '}
      <a
        href={NEW_URL}
        style={{ color: '#92400e', textDecoration: 'underline', fontWeight: 600 }}
      >
        fuelpos.sitaratech.info
      </a>
    </div>
  );
}
