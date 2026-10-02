import { useCallback, useEffect, useState } from 'react';

/** Chrome/Edge/Android fire this; Safari never does. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const KEY = 'relay-install-dismissed';
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** iOS Safari (not Chrome/Firefox/in-app browsers on iOS, which can't add to home screen the same way). */
export const isIosSafari = (ua = navigator.userAgent, maxTouch = navigator.maxTouchPoints) => {
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouch > 1); // iPadOS reports as Mac
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA|FBAN|FBAV|Instagram/.test(ua);
};

const recentlyDismissed = () => {
  try {
    const t = Number(localStorage.getItem(KEY));
    return t > 0 && Date.now() - t < COOLDOWN_MS;
  } catch { return false; }
};

export function useInstall() {
  const [evt, setEvt] = useState<InstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(() => isStandalone() || recentlyDismissed());
  const ios = isIosSafari();

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as InstallPromptEvent); };
    const onInstalled = () => { setEvt(null); setHidden(true); };
    addEventListener('beforeinstallprompt', onPrompt);
    addEventListener('appinstalled', onInstalled);
    return () => { removeEventListener('beforeinstallprompt', onPrompt); removeEventListener('appinstalled', onInstalled); };
  }, []);

  const dismiss = useCallback(() => {
    try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ }
    setHidden(true);
  }, []);

  const install = useCallback(async () => {
    if (!evt) return;
    await evt.prompt();
    const { outcome } = await evt.userChoice;
    setEvt(null); // the event can only be used once
    if (outcome === 'dismissed') dismiss();
    else setHidden(true);
  }, [evt, dismiss]);

  const mode: 'prompt' | 'ios' | null = hidden ? null : evt ? 'prompt' : ios ? 'ios' : null;
  return { mode, install, dismiss };
}
