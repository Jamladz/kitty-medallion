import { TelegramWebAppUser } from '../types';
import { REFERRAL_CONFIG } from './rewardsEngine';

export const OFFICIAL_BOT_USERNAME = 'kittymedallion_bot';

// Capture initial launch search & hash parameters immediately at module load time
// BEFORE React Router alters window.location.hash or search.
const INITIAL_LAUNCH_SEARCH =
  typeof window !== 'undefined' ? window.location.search : '';
const INITIAL_LAUNCH_HASH =
  typeof window !== 'undefined' ? window.location.hash : '';

/**
 * Cleans the "ref_" prefix (including URL-encoded or Base64-encoded start_param values)
 * and validates that the referrerId is a valid numeric Telegram ID
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

  if (!candidate) return null;
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

// Immediately persist any referrer detected at bundle evaluation time
if (typeof window !== 'undefined') {
  const earlyRef =
    sanitizeReferrerId(window.Telegram?.WebApp?.initDataUnsafe?.start_param) ||
    extractReferrerFromUrlStrings(INITIAL_LAUNCH_SEARCH, INITIAL_LAUNCH_HASH);
  if (earlyRef) {
    persistDetectedReferrer(earlyRef);
  }
}

/**
 * Reads the referrer ID on app launch in exact priority order:
 * 1) Telegram WebApp start_param (initDataUnsafe.start_param or raw initData)
 * 2) Fallback: Page URL query & hash parameters (startapp / ref / start / tgWebAppStartParam)
 * 3) Persisted pending referrer from session/localStorage
 */
export function detectReferrerOnLaunch(currentUserId?: string): string | null {
  if (typeof window === 'undefined') return null;

  // Priority A1: Telegram WebApp initDataUnsafe.start_param
  const tgStartParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
  const fromTelegram = sanitizeReferrerId(tgStartParam, currentUserId);
  if (fromTelegram) {
    persistDetectedReferrer(fromTelegram);
    return fromTelegram;
  }

  // Priority A2: Telegram WebApp raw initData string start_param
  try {
    const rawInitData = window.Telegram?.WebApp?.initData;
    if (rawInitData) {
      const initParams = new URLSearchParams(rawInitData);
      const fromRawInit = sanitizeReferrerId(
        initParams.get('start_param'),
        currentUserId
      );
      if (fromRawInit) {
        persistDetectedReferrer(fromRawInit);
        return fromRawInit;
      }
    }
  } catch {}

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

  // Priority B2: Initial launch search & hash captured before router mount
  const fromInitialUrl = extractReferrerFromUrlStrings(
    INITIAL_LAUNCH_SEARCH,
    INITIAL_LAUNCH_HASH,
    currentUserId
  );
  if (fromInitialUrl) {
    persistDetectedReferrer(fromInitialUrl);
    return fromInitialUrl;
  }

  // Priority C: Persisted pending referrer
  try {
    const cached =
      sessionStorage.getItem('kitty_detected_referrer') ||
      localStorage.getItem('kitty_pending_referrer');
    if (cached) {
      return sanitizeReferrerId(cached, currentUserId);
    }
  } catch {}

  return null;
}

export function getTelegramInitData(): string {
  if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
    return window.Telegram.WebApp.initData || '';
  }
  return '';
}

export function getEffectiveTelegramUser(): TelegramWebAppUser {
  if (typeof window !== 'undefined') {
    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
    if (tgUser && tgUser.id) {
      return {
        id: String(tgUser.id),
        first_name: tgUser.first_name || 'Miner',
        last_name: tgUser.last_name || '',
        username: tgUser.username || '',
        photo_url: tgUser.photo_url,
      };
    }

    const rawInit = window.Telegram?.WebApp?.initData;
    if (rawInit) {
      try {
        const userJson = new URLSearchParams(rawInit).get('user');
        if (userJson) {
          const parsed = JSON.parse(userJson);
          if (parsed && parsed.id) {
            return {
              id: String(parsed.id),
              first_name: parsed.first_name || 'Miner',
              last_name: parsed.last_name || '',
              username: parsed.username || '',
              photo_url: parsed.photo_url,
            };
          }
        }
      } catch {}
    }

    try {
      const hashStr = window.location.hash.replace(/^#/, '');
      const hashParams = new URLSearchParams(hashStr);
      const tgWebAppData = hashParams.get('tgWebAppData');
      if (tgWebAppData) {
        const userJson = new URLSearchParams(tgWebAppData).get('user');
        if (userJson) {
          const parsed = JSON.parse(userJson);
          if (parsed && parsed.id) {
            return {
              id: String(parsed.id),
              first_name: parsed.first_name || 'Miner',
              last_name: parsed.last_name || '',
              username: parsed.username || '',
              photo_url: parsed.photo_url,
            };
          }
        }
      }
    } catch {}

    // Browser preview support: generate distinct visitor ID if testing any referral link in browser
    try {
      const search = new URLSearchParams(window.location.search);
      const rawRef =
        search.get('startapp') ||
        search.get('ref') ||
        search.get('start') ||
        search.get('tgWebAppStartParam') ||
        '';
      const cleanedRef = sanitizeReferrerId(rawRef);
      const storedVisitorId = sessionStorage.getItem('kitty_browser_visitor_id');
      if (storedVisitorId) {
        return {
          id: storedVisitorId,
          first_name: 'Invited',
          last_name: `Fren #${storedVisitorId.slice(-4)}`,
          username: `fren_${storedVisitorId.slice(-4)}`,
        };
      }
      if (cleanedRef) {
        const generatedId = String(
          Math.floor(100000000 + Math.random() * 800000000)
        );
        sessionStorage.setItem('kitty_browser_visitor_id', generatedId);
        return {
          id: generatedId,
          first_name: 'Invited',
          last_name: `Fren #${generatedId.slice(-4)}`,
          username: `fren_${generatedId.slice(-4)}`,
        };
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

/**
 * Generates the user's unique Telegram Mini App referral invite link by Telegram ID:
 * https://t.me/kittymedallion_bot?startapp=ref_tg_<userId>
 */
export function buildReferralLink(
  userId: string,
  botUsername = OFFICIAL_BOT_USERNAME,
  appShortName = ''
): string {
  const cleanUserId = String(userId || '').trim();
  const cleanBot =
    (botUsername || OFFICIAL_BOT_USERNAME).replace(/^@/, '').trim() ||
    OFFICIAL_BOT_USERNAME;
  const cleanShort = (appShortName || '').replace(/^\/+|\/+$/g, '').trim();

  if (cleanShort) {
    return `https://t.me/${cleanBot}/${cleanShort}?startapp=ref_tg_${cleanUserId}`;
  }
  return `https://t.me/${cleanBot}?startapp=ref_tg_${cleanUserId}`;
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
    (
      window.Telegram?.WebApp as {
        HapticFeedback?: {
          notificationOccurred?: (t: string) => void;
        };
      }
    )?.HapticFeedback?.notificationOccurred?.(type);
  } catch {}
}
