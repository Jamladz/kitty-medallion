import { HomeScreenStatus, TelegramWebAppUser } from '../types';
import { REFERRAL_CONFIG } from './rewardsEngine';

export const OFFICIAL_BOT_USERNAME = 'kittymedallion_bot';
const HOME_SCREEN_ADDED_STORAGE_KEY = 'kitty_tg_homescreen_added_v1';

// Capture initial launch search & hash parameters immediately at module load time
// BEFORE React Router alters window.location.hash or search.
const INITIAL_LAUNCH_SEARCH =
  typeof window !== 'undefined'
    ? (window as any).__INITIAL_LAUNCH_SEARCH__ || window.location.search || ''
    : '';
const INITIAL_LAUNCH_HASH =
  typeof window !== 'undefined'
    ? (window as any).__INITIAL_LAUNCH_HASH__ || window.location.hash || ''
    : '';
const INITIAL_LAUNCH_HREF =
  typeof window !== 'undefined'
    ? (window as any).__INITIAL_LAUNCH_HREF__ || window.location.href || ''
    : '';

/**
 * Syncs Telegram Bot API 8.0+ safeAreaInset & contentSafeAreaInset to root CSS variables
 * so the fixed header and bottom navigation never overlap Telegram's native fullscreen bar.
 */
export function syncTelegramSafeAreas(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const webApp = window.Telegram?.WebApp;
  if (!webApp) return;

  try {
    const safeTop = Number(webApp.safeAreaInset?.top) || 0;
    const contentTop = Number(webApp.contentSafeAreaInset?.top) || 0;
    const totalTop = safeTop + contentTop;

    const safeBottom = Number(webApp.safeAreaInset?.bottom) || 0;
    const contentBottom = Number(webApp.contentSafeAreaInset?.bottom) || 0;
    const totalBottom = Math.max(safeBottom, contentBottom);

    const root = document.documentElement;
    if (totalTop > 0) {
      root.style.setProperty('--tg-header-safe-top', `${totalTop}px`);
    } else {
      root.style.removeProperty('--tg-header-safe-top');
    }

    if (totalBottom > 0) {
      root.style.setProperty('--tg-nav-safe-bottom', `${totalBottom}px`);
    } else {
      root.style.removeProperty('--tg-nav-safe-bottom');
    }

    if (webApp.viewportStableHeight && webApp.viewportStableHeight > 100) {
      root.style.setProperty(
        '--app-height',
        `${webApp.viewportStableHeight}px`
      );
    }
  } catch {}
}

let fullscreenInitialized = false;
let fullscreenUnsupported = false;

/**
 * Requests full-screen mode using the official Telegram Mini Apps API (Bot API 8.0+):
 * 1) webApp.ready() & webApp.expand()
 * 2) webApp.disableVerticalSwipes() (Bot API 7.7+)
 * 3) webApp.requestFullscreen() (Bot API 8.0+)
 * 4) Listens to fullscreenChanged, fullscreenFailed, safeAreaChanged, contentSafeAreaChanged, viewportChanged
 */
export function initTelegramFullscreen(): void {
  if (typeof window === 'undefined') return;
  const webApp = window.Telegram?.WebApp;
  if (!webApp) return;

  try {
    webApp.ready();
  } catch {}

  try {
    webApp.expand();
  } catch {}

  try {
    if (typeof webApp.disableVerticalSwipes === 'function') {
      webApp.disableVerticalSwipes();
    }
  } catch {}

  try {
    webApp.setHeaderColor?.('#0b0b0e');
    webApp.setBackgroundColor?.('#0b0b0e');
    webApp.setBottomBarColor?.('#0b0b0e');
  } catch {}

  const attemptRequestFullscreen = () => {
    if (fullscreenUnsupported) return;
    try {
      if (!webApp.isExpanded) {
        webApp.expand();
      }
      const supportsFullscreen =
        typeof webApp.requestFullscreen === 'function' &&
        (!webApp.isVersionAtLeast || webApp.isVersionAtLeast('8.0'));

      if (supportsFullscreen && !webApp.isFullscreen) {
        webApp.requestFullscreen!();
      }
    } catch {}
    syncTelegramSafeAreas();
  };

  if (!fullscreenInitialized) {
    fullscreenInitialized = true;

    try {
      if (typeof webApp.onEvent === 'function') {
        webApp.onEvent('fullscreenChanged', () => {
          syncTelegramSafeAreas();
        });

        webApp.onEvent('fullscreenFailed', (payload?: { error?: string }) => {
          if (payload?.error === 'UNSUPPORTED') {
            fullscreenUnsupported = true;
          }
          try {
            webApp.expand();
          } catch {}
          syncTelegramSafeAreas();
        });

        webApp.onEvent('safeAreaChanged', syncTelegramSafeAreas);
        webApp.onEvent('contentSafeAreaChanged', syncTelegramSafeAreas);
        webApp.onEvent('viewportChanged', syncTelegramSafeAreas);
        webApp.onEvent('activated', () => {
          attemptRequestFullscreen();
        });

        // Also listen globally for official homeScreenAdded event so we never miss it
        webApp.onEvent('homeScreenAdded', () => {
          markHomeScreenAddedLocally();
        });
      }
    } catch {}

    // One-time gesture fallback in case mobile WebView requires a user interaction to enter fullscreen
    const handleFirstInteraction = () => {
      attemptRequestFullscreen();
      window.removeEventListener('pointerdown', handleFirstInteraction);
      window.removeEventListener('touchstart', handleFirstInteraction);
    };
    window.addEventListener('pointerdown', handleFirstInteraction, {
      passive: true,
    });
    window.addEventListener('touchstart', handleFirstInteraction, {
      passive: true,
    });
  }

  attemptRequestFullscreen();
  setTimeout(attemptRequestFullscreen, 150);
  setTimeout(syncTelegramSafeAreas, 350);
}

/**
 * Records locally that Telegram's official `homeScreenAdded` event or `checkHomeScreenStatus === 'added'` succeeded.
 */
export function markHomeScreenAddedLocally(): void {
  try {
    localStorage.setItem(HOME_SCREEN_ADDED_STORAGE_KEY, '1');
  } catch {}
}

export function isHomeScreenAddedLocally(): boolean {
  try {
    return localStorage.getItem(HOME_SCREEN_ADDED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Official Telegram Bot API 8.0+ Home Screen Status Checker:
 * Calls `Telegram.WebApp.checkHomeScreenStatus(callback)` and listens to `homeScreenChecked`.
 * Returns: 'added' | 'missed' | 'unknown' | 'unsupported'
 */
export function checkOfficialTelegramHomeScreenStatus(): Promise<HomeScreenStatus> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve('unsupported');
      return;
    }

    const webApp = window.Telegram?.WebApp;
    if (!webApp) {
      resolve('unsupported');
      return;
    }

    const supportsHomeScreen =
      typeof webApp.checkHomeScreenStatus === 'function' &&
      (!webApp.isVersionAtLeast || webApp.isVersionAtLeast('8.0'));

    if (!supportsHomeScreen) {
      resolve('unsupported');
      return;
    }

    let settled = false;
    const finish = (rawStatus?: string) => {
      if (settled) return;
      settled = true;
      try {
        webApp.offEvent?.('homeScreenChecked', handleEvent);
      } catch {}

      const normalized = String(rawStatus || '').toLowerCase();
      if (normalized === 'added') {
        markHomeScreenAddedLocally();
        resolve('added');
      } else if (normalized === 'missed' || normalized === 'not-added') {
        resolve('missed');
      } else if (normalized === 'unknown') {
        resolve(isHomeScreenAddedLocally() ? 'added' : 'unknown');
      } else if (normalized === 'unsupported') {
        resolve('unsupported');
      } else {
        resolve(isHomeScreenAddedLocally() ? 'added' : 'unknown');
      }
    };

    const handleEvent = (payload?: { status?: string } | string) => {
      const st =
        typeof payload === 'string' ? payload : payload?.status || 'unknown';
      finish(st);
    };

    try {
      webApp.onEvent?.('homeScreenChecked', handleEvent);
      webApp.checkHomeScreenStatus!((status: HomeScreenStatus) => {
        finish(status);
      });
    } catch {
      finish('unsupported');
    }

    setTimeout(() => {
      finish(isHomeScreenAddedLocally() ? 'added' : 'unknown');
    }, 1800);
  });
}

/**
 * Verifies that a user ID belongs to a real Telegram account (numeric 5..20 digits)
 * and is never the mock browser preview account ('999999999') or a test ID.
 */
export function isRealTelegramUserId(id?: string | null): boolean {
  if (!id) return false;
  const clean = String(id).trim();
  if (!clean || clean === '999999999' || clean === '0') return false;
  if (clean.startsWith('test_')) return false;
  return /^\d{5,20}$/.test(clean);
}

/**
 * Formats a Telegram user's display name professionally like native Telegram Mini Apps.
 * Strips artificial legacy "User" last names so single-name Telegram users display cleanly.
 */
export function formatTelegramDisplayName(
  firstName?: string | null,
  lastName?: string | null,
  username?: string | null,
  fallbackId?: string | null
): string {
  const cleanFirst = String(firstName || '').trim();
  const rawLast = String(lastName || '').trim();
  const cleanLast =
    rawLast.toLowerCase() === 'user' &&
    cleanFirst.toLowerCase() !== 'developer'
      ? ''
      : rawLast;

  const full = `${cleanFirst} ${cleanLast}`
    .replace(/\s+User$/i, '')
    .trim();

  if (
    full &&
    full.toLowerCase() !== 'miner' &&
    full.toLowerCase() !== 'telegram friend' &&
    full.toLowerCase() !== 'developer user' &&
    full.toLowerCase() !== 'developer'
  ) {
    return full;
  }

  const cleanUsername = String(username || '')
    .trim()
    .replace(/^@/, '');
  if (cleanUsername && cleanUsername !== 'dev_user') {
    return cleanUsername;
  }

  if (cleanFirst && cleanFirst.toLowerCase() !== 'developer') {
    return cleanFirst;
  }

  if (fallbackId && isRealTelegramUserId(fallbackId)) {
    return `Telegram User #${String(fallbackId).slice(-4)}`;
  }

  return 'Telegram User';
}

/**
 * Cleans the "ref_tg_" / "ref_" prefix (including URL-encoded or Base64-encoded start_param values)
 * and validates that the referrerId is a real numeric Telegram ID
 * and not equal to currentUserId (prevents self-referral).
 */
export function sanitizeReferrerId(
  rawParam: string | null | undefined,
  currentUserId?: string
): string | null {
  if (!rawParam) return null;

  let decoded = String(rawParam).trim();
  if (!decoded || decoded === 'null' || decoded === 'undefined') return null;

  // Try URL decoding (handles double-encoded start_param)
  for (let i = 0; i < 2; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }

  const tryExtractNumericId = (input: string): string | null => {
    const cleaned = input
      .trim()
      .replace(
        /^(ref_tg_|ref_tg-|ref_|r_|ref-|invite_|inviter_|tg_|u_|user_|startapp=|start=|ref=)+/i,
        ''
      )
      .trim();

    if (/^\d{5,20}$/.test(cleaned)) {
      return cleaned;
    }
    const match = cleaned.match(
      /(?:ref_tg_|ref_tg-|ref_|r_|ref-|invite_|inviter_|tg_|u_|user_)?(\d{5,20})/i
    );
    if (match && match[1]) {
      return match[1];
    }
    return null;
  };

  let candidate = tryExtractNumericId(decoded);

  // Also check if start_param was base64 encoded (e.g., cmVmX3RnXzEzNjg4OTk4NDI=)
  if (!candidate && typeof atob === 'function') {
    try {
      const b64Normalized = decoded.replace(/-/g, '+').replace(/_/g, '/');
      const padded =
        b64Normalized + '='.repeat((4 - (b64Normalized.length % 4)) % 4);
      const fromBase64 = atob(padded);
      candidate = tryExtractNumericId(fromBase64);
    } catch {}
  }

  if (!candidate || !isRealTelegramUserId(candidate)) return null;
  if (currentUserId && candidate === String(currentUserId)) {
    return null; // Ignore self-referral
  }
  return candidate;
}

export function persistDetectedReferrer(refId: string) {
  try {
    sessionStorage.setItem('kitty_detected_referrer', refId);
    localStorage.setItem('kitty_pending_referrer', refId);
  } catch {}
}

export function clearPendingReferrer() {
  try {
    sessionStorage.removeItem('kitty_detected_referrer');
    localStorage.removeItem('kitty_pending_referrer');
  } catch {}
}

function extractReferrerFromUrlStrings(
  searchStr: string,
  hashRaw: string,
  currentUserId?: string
): string | null {
  try {
    const searchParams = new URLSearchParams(searchStr);
    const queryCandidate =
      searchParams.get('startapp') ||
      searchParams.get('tgWebAppStartParam') ||
      searchParams.get('start_param') ||
      searchParams.get('ref') ||
      searchParams.get('start') ||
      searchParams.get('inviter');

    const fromQuery = sanitizeReferrerId(queryCandidate, currentUserId);
    if (fromQuery) return fromQuery;

    const hashStr = hashRaw.replace(/^#/, '');
    const candidatesToParse = [hashStr];
    const qIdx = hashStr.indexOf('?');
    if (qIdx >= 0) {
      candidatesToParse.unshift(hashStr.slice(qIdx + 1));
    }

    for (const part of candidatesToParse) {
      const hashQuery = new URLSearchParams(part);
      const hashCandidate =
        hashQuery.get('startapp') ||
        hashQuery.get('tgWebAppStartParam') ||
        hashQuery.get('start_param') ||
        hashQuery.get('ref') ||
        hashQuery.get('start') ||
        hashQuery.get('inviter');

      const fromHash = sanitizeReferrerId(hashCandidate, currentUserId);
      if (fromHash) return fromHash;

      const tgWebAppData = hashQuery.get('tgWebAppData');
      if (tgWebAppData) {
        const innerParams = new URLSearchParams(tgWebAppData);
        const fromInner = sanitizeReferrerId(
          innerParams.get('start_param'),
          currentUserId
        );
        if (fromInner) return fromInner;
      }
    }
  } catch {}
  return null;
}

function extractReferrerFromTelegramInternals(
  currentUserId?: string
): string | null {
  if (typeof window === 'undefined') return null;

  // 1. Official Telegram.WebApp.initDataUnsafe.start_param
  const tgStartParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
  const fromUnsafe = sanitizeReferrerId(tgStartParam, currentUserId);
  if (fromUnsafe) return fromUnsafe;

  // 2. Official Telegram.WebApp.initData query string
  try {
    const rawInitData = window.Telegram?.WebApp?.initData;
    if (rawInitData) {
      const initParams = new URLSearchParams(rawInitData);
      const fromRawInit = sanitizeReferrerId(
        initParams.get('start_param') || initParams.get('tgWebAppStartParam'),
        currentUserId
      );
      if (fromRawInit) return fromRawInit;
    }
  } catch {}

  // 3. Telegram.WebView.initParams (populated directly by telegram-web-app.js)
  try {
    const webViewParams = (window as any).Telegram?.WebView?.initParams;
    if (webViewParams && typeof webViewParams === 'object') {
      const fromWvStart = sanitizeReferrerId(
        webViewParams.tgWebAppStartParam || webViewParams.start_param,
        currentUserId
      );
      if (fromWvStart) return fromWvStart;

      if (webViewParams.tgWebAppData) {
        const wvDataParams = new URLSearchParams(
          String(webViewParams.tgWebAppData)
        );
        const fromWvData = sanitizeReferrerId(
          wvDataParams.get('start_param') ||
            wvDataParams.get('tgWebAppStartParam'),
          currentUserId
        );
        if (fromWvData) return fromWvData;
      }
    }
  } catch {}

  // 4. sessionStorage['__telegram__initParams'] (stored by telegram-web-app.js before hash changes)
  try {
    const rawStored =
      sessionStorage.getItem('__telegram__initParams') ||
      sessionStorage.getItem('initParams');
    if (rawStored) {
      const parsed = JSON.parse(rawStored);
      if (parsed && typeof parsed === 'object') {
        const fromStoredStart = sanitizeReferrerId(
          parsed.tgWebAppStartParam || parsed.start_param,
          currentUserId
        );
        if (fromStoredStart) return fromStoredStart;

        if (parsed.tgWebAppData) {
          const inner = new URLSearchParams(String(parsed.tgWebAppData));
          const fromInner = sanitizeReferrerId(
            inner.get('start_param') || inner.get('tgWebAppStartParam'),
            currentUserId
          );
          if (fromInner) return fromInner;
        }
      }
    }
  } catch {}

  return null;
}

/**
 * Reads the referrer ID on app launch in exact priority order:
 * 1) Telegram WebApp / WebView start_param (initDataUnsafe, initData, WebView.initParams, __telegram__initParams)
 * 2) Page URL query & hash parameters (live URL, initial pre-router URL, and performance navigation URL)
 * 3) Persisted pending referrer from session/localStorage
 */
export function detectReferrerOnLaunch(currentUserId?: string): string | null {
  if (typeof window === 'undefined') return null;

  // Priority A: Telegram WebApp & WebView internals
  const fromTelegram = extractReferrerFromTelegramInternals(currentUserId);
  if (fromTelegram) {
    persistDetectedReferrer(fromTelegram);
    return fromTelegram;
  }

  // Priority B1: Live window.location.search & window.location.hash
  const fromLiveUrl = extractReferrerFromUrlStrings(
    window.location.search,
    window.location.hash,
    currentUserId
  );
  if (fromLiveUrl) {
    persistDetectedReferrer(fromLiveUrl);
    return fromLiveUrl;
  }

  // Priority B2: Initial launch search & hash captured in index.html before telegram-web-app.js / router
  const fromInitialUrl = extractReferrerFromUrlStrings(
    INITIAL_LAUNCH_SEARCH,
    INITIAL_LAUNCH_HASH,
    currentUserId
  );
  if (fromInitialUrl) {
    persistDetectedReferrer(fromInitialUrl);
    return fromInitialUrl;
  }

  // Priority B3: Full initial href or PerformanceNavigationTiming entry
  try {
    const navEntries = window.performance?.getEntriesByType?.('navigation') as
      | PerformanceNavigationTiming[]
      | undefined;
    const candidateHrefs = [
      INITIAL_LAUNCH_HREF,
      navEntries && navEntries[0] ? navEntries[0].name : '',
    ];
    for (const href of candidateHrefs) {
      if (!href) continue;
      const parsedUrl = new URL(href, window.location.origin);
      const fromHref = extractReferrerFromUrlStrings(
        parsedUrl.search,
        parsedUrl.hash,
        currentUserId
      );
      if (fromHref) {
        persistDetectedReferrer(fromHref);
        return fromHref;
      }
    }
  } catch {}

  // Priority C: Persisted pending referrer (check session and local independently so self-ID in one never blocks the other)
  try {
    const fromSession = sanitizeReferrerId(
      sessionStorage.getItem('kitty_detected_referrer'),
      currentUserId
    );
    if (fromSession) return fromSession;

    const fromLocal = sanitizeReferrerId(
      localStorage.getItem('kitty_pending_referrer'),
      currentUserId
    );
    if (fromLocal) return fromLocal;
  } catch {}

  return null;
}

export function getTelegramInitData(): string {
  if (typeof window !== 'undefined') {
    if (window.Telegram?.WebApp?.initData) {
      return window.Telegram.WebApp.initData;
    }
    const wvData = (window as any).Telegram?.WebView?.initParams?.tgWebAppData;
    if (wvData) return String(wvData);
  }
  return '';
}

export function getEffectiveTelegramUser(): TelegramWebAppUser {
  if (typeof window !== 'undefined') {
    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
    if (tgUser && tgUser.id) {
      const resolved: TelegramWebAppUser = {
        id: String(tgUser.id),
        first_name: tgUser.first_name || 'Miner',
        last_name: tgUser.last_name || '',
        username: tgUser.username || '',
        photo_url: tgUser.photo_url,
      };
      try {
        sessionStorage.setItem(
          'kitty_real_tg_user_session',
          JSON.stringify(resolved)
        );
      } catch {}
      return resolved;
    }

    const rawInitCandidates = [
      window.Telegram?.WebApp?.initData,
      (window as any).Telegram?.WebView?.initParams?.tgWebAppData,
    ];
    try {
      const rawStored = sessionStorage.getItem('__telegram__initParams');
      if (rawStored) {
        const parsedStored = JSON.parse(rawStored);
        if (parsedStored?.tgWebAppData) {
          rawInitCandidates.push(String(parsedStored.tgWebAppData));
        }
      }
    } catch {}

    for (const rawInit of rawInitCandidates) {
      if (!rawInit) continue;
      try {
        const userJson = new URLSearchParams(String(rawInit)).get('user');
        if (userJson) {
          const parsed = JSON.parse(userJson);
          if (parsed && parsed.id) {
            const resolved: TelegramWebAppUser = {
              id: String(parsed.id),
              first_name: parsed.first_name || 'Miner',
              last_name: parsed.last_name || '',
              username: parsed.username || '',
              photo_url: parsed.photo_url,
            };
            try {
              sessionStorage.setItem(
                'kitty_real_tg_user_session',
                JSON.stringify(resolved)
              );
            } catch {}
            return resolved;
          }
        }
      } catch {}
    }

    try {
      const hashCandidates = [window.location.hash, INITIAL_LAUNCH_HASH];
      for (const h of hashCandidates) {
        if (!h) continue;
        const hashStr = h.replace(/^#/, '');
        const hashParams = new URLSearchParams(hashStr);
        const tgWebAppData = hashParams.get('tgWebAppData');
        if (tgWebAppData) {
          const userJson = new URLSearchParams(tgWebAppData).get('user');
          if (userJson) {
            const parsed = JSON.parse(userJson);
            if (parsed && parsed.id) {
              const resolved: TelegramWebAppUser = {
                id: String(parsed.id),
                first_name: parsed.first_name || 'Miner',
                last_name: parsed.last_name || '',
                username: parsed.username || '',
                photo_url: parsed.photo_url,
              };
              try {
                sessionStorage.setItem(
                  'kitty_real_tg_user_session',
                  JSON.stringify(resolved)
                );
              } catch {}
              return resolved;
            }
          }
        }
      }
    } catch {}

    // Check if we already captured the real Telegram user earlier in this WebView session
    try {
      sessionStorage.removeItem('kitty_browser_visitor_id');
      const sessionUserRaw = sessionStorage.getItem(
        'kitty_real_tg_user_session'
      );
      if (sessionUserRaw) {
        const parsed = JSON.parse(sessionUserRaw);
        if (parsed && parsed.id && isRealTelegramUserId(String(parsed.id))) {
          return parsed;
        }
      }
    } catch {}
  }

  return {
    id: '999999999',
    first_name: 'Developer',
    last_name: 'User',
    username: 'dev_user',
  };
}

// Immediately persist any referrer detected & initialize Telegram Fullscreen at bundle load time
if (typeof window !== 'undefined') {
  const currentUid = getEffectiveTelegramUser()?.id;
  const earlyRef =
    extractReferrerFromTelegramInternals(currentUid) ||
    extractReferrerFromUrlStrings(
      INITIAL_LAUNCH_SEARCH,
      INITIAL_LAUNCH_HASH,
      currentUid
    );
  if (earlyRef) {
    persistDetectedReferrer(earlyRef);
  }
  initTelegramFullscreen();
}

/**
 * Generates the user's unique Telegram Mini App referral invite link by Telegram ID:
 * https://t.me/kittymedallion_bot?startapp=ref_tg_<userId>
 */
export function buildReferralLink(
  userId: string,
  _botUsername = OFFICIAL_BOT_USERNAME,
  _appShortName = ''
): string {
  const cleanUserId = String(userId || '').trim();
  return `https://t.me/${OFFICIAL_BOT_USERNAME}?startapp=ref_tg_${cleanUserId}`;
}

/**
 * Generates the ready-to-share Telegram URL:
 * https://t.me/share/url?url=...&text=...
 */
export function buildTelegramShareUrl(referralLink: string): string {
  const promoText = `🐱💵 Join me on Kitty Medallion! Claim an instant +${REFERRAL_CONFIG.WELCOME_BONUS_USDT}.00 USDT & +${REFERRAL_CONFIG.WELCOME_BONUS} KITTY Welcome Gift when you open my invite link!`;
  return `https://t.me/share/url?url=${encodeURIComponent(
    referralLink
  )}&text=${encodeURIComponent(promoText)}`;
}

export function triggerTelegramHaptic(
  type: 'success' | 'warning' | 'error' = 'success'
) {
  try {
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.(type);
  } catch {}
}
