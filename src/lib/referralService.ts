import { db } from './firebase';
import {
  getEffectiveTelegramUser,
  getClientCachedUser,
  notifyUserUpdated,
} from './api';
import {
  doc,
  collection,
  query,
  where,
  limit,
  getDocs,
  runTransaction,
  increment,
  arrayUnion,
} from 'firebase/firestore';

// ============================================================================
// 1. KITTY MEDALLION REFERRAL REWARDS & MILESTONES CONFIGURATION
// ============================================================================

export const REFERRAL_CONFIG = {
  WELCOME_BONUS: 100,        // +100 KITTY instant welcome bonus for the invited friend
  WELCOME_BONUS_USDT: 2,     // +2.00 USDT first-time referral entry gift for the invited friend
  REFERRER_REWARD: 250,      // +250 KITTY instant referral reward for the inviter
  REFERRER_SPEED_BOOST: 50,  // +50 KITTY/24h permanent mining speed boost for the inviter
  DEFAULT_BASE_SPEED: 500,   // 500 KITTY/24h default base mining speed
};

export interface ReferralMilestone {
  id: string;
  title: string;
  targetCount: number;
  rewardCoins: number;
  speedBoost: number;
  vipDays: number;
  badgeLabel: string;
}

export const REFERRAL_MILESTONES: ReferralMilestone[] = [
  {
    id: 'milestone_3',
    title: 'Bronze Recruiter',
    targetCount: 3,
    rewardCoins: 500,
    speedBoost: 100,
    vipDays: 1,
    badgeLabel: '1 Day VIP + 100 Hash/24h',
  },
  {
    id: 'milestone_5',
    title: 'Silver Commander',
    targetCount: 5,
    rewardCoins: 1000,
    speedBoost: 200,
    vipDays: 3,
    badgeLabel: '3 Days VIP + 200 Hash/24h',
  },
  {
    id: 'milestone_10',
    title: 'Gold Ambassador',
    targetCount: 10,
    rewardCoins: 2500,
    speedBoost: 500,
    vipDays: 7,
    badgeLabel: '7 Days VIP + 500 Hash/24h',
  },
  {
    id: 'milestone_25',
    title: 'Diamond Syndicate',
    targetCount: 25,
    rewardCoins: 7000,
    speedBoost: 1500,
    vipDays: 30,
    badgeLabel: '30 Days VIP + 1,500 Hash/24h',
  },
];

export interface ReferralRecord {
  id: string;
  referrerId: string;
  referredId: string;
  referredName: string;
  referredUsername?: string;
  rewardAmount: number;
  welcomeBonus: number;
  speedBoost: number;
  timestamp: number;
}

// ============================================================================
// 2. REFERRAL DETECTION & LINK GENERATION HELPERS
// ============================================================================

/**
 * Cleans the "ref_" prefix and validates that the referrerId is non-empty and not equal to currentUserId.
 */
export function sanitizeReferrerId(
  rawParam: string | null | undefined,
  currentUserId?: string
): string | null {
  if (!rawParam) return null;
  const cleaned = String(rawParam)
    .trim()
    .replace(/^(ref_|r_|ref-|invite_|startapp=)/i, '')
    .trim();

  let candidate: string | null = null;
  if (/^\d+$/.test(cleaned)) {
    candidate = cleaned;
  } else {
    const match = cleaned.match(/(?:ref_|r_|ref-|invite_)?(\d{5,20})/i);
    if (match && match[1]) {
      candidate = match[1];
    }
  }

  if (!candidate) return null;
  if (currentUserId && candidate === String(currentUserId)) {
    // Self-referral check -> ignore completely
    return null;
  }
  return candidate;
}

/**
 * Checks whether a user already has a valid real referrer (ignores null, empty string, self, or mock 999999999).
 * This allows users who entered the app previously WITHOUT a referral link to still be referred when invited later.
 */
export function hasValidReferrer(
  userData: any,
  currentUserId?: string
): boolean {
  if (!userData) return false;
  const raw = String(userData.referredBy || userData.referrerId || '').trim();
  if (!raw || raw === 'null' || raw === 'undefined') return false;
  if (currentUserId && raw === String(currentUserId)) return false;
  if (raw === '999999999' && String(currentUserId || '') !== '999999999') {
    return false;
  }
  return /^\d+$/.test(raw);
}

export function clearPendingReferrer() {
  try {
    sessionStorage.removeItem('kitty_detected_referrer');
    localStorage.removeItem('kitty_pending_referrer');
  } catch {}
}

function persistDetectedReferrer(refId: string) {
  try {
    sessionStorage.setItem('kitty_detected_referrer', refId);
    localStorage.setItem('kitty_pending_referrer', refId);
  } catch {}
}

// Capture initial URL search and hash parameters immediately at module load time
// BEFORE HashRouter or any component mounts and alters window.location.hash.
const INITIAL_LAUNCH_SEARCH =
  typeof window !== 'undefined' ? window.location.search : '';
const INITIAL_LAUNCH_HASH =
  typeof window !== 'undefined' ? window.location.hash : '';

function extractFromUrlStrings(
  searchStr: string,
  hashRaw: string,
  currentUserId?: string
): string | null {
  try {
    const searchParams = new URLSearchParams(searchStr);
    const queryCandidate =
      searchParams.get('startapp') ||
      searchParams.get('tgWebAppStartParam') ||
      searchParams.get('ref') ||
      searchParams.get('start');

    const fromQuery = sanitizeReferrerId(queryCandidate, currentUserId);
    if (fromQuery) return fromQuery;

    const hashStr = hashRaw.replace(/^#/, '');
    // Check both before and after '?' inside hash
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
        hashQuery.get('ref') ||
        hashQuery.get('start');

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

// Immediately persist any referrer present at bundle load time
if (typeof window !== 'undefined') {
  const earlyRef =
    sanitizeReferrerId(window.Telegram?.WebApp?.initDataUnsafe?.start_param) ||
    extractFromUrlStrings(INITIAL_LAUNCH_SEARCH, INITIAL_LAUNCH_HASH);
  if (earlyRef) {
    persistDetectedReferrer(earlyRef);
  }
}

/**
 * Reads the referrer ID on app launch in exact priority order:
 * 1) Telegram WebApp start_param (initDataUnsafe.start_param or initData start_param)
 * 2) Fallback: Page URL query & hash parameters (both initial launch URL and current URL)
 * 3) Persisted pending referrer from session/localStorage if not yet applied
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
  const fromLiveUrl = extractFromUrlStrings(
    window.location.search,
    window.location.hash,
    currentUserId
  );
  if (fromLiveUrl) {
    persistDetectedReferrer(fromLiveUrl);
    return fromLiveUrl;
  }

  // Priority B2: Initial launch search & hash captured before HashRouter mounted
  const fromInitialUrl = extractFromUrlStrings(
    INITIAL_LAUNCH_SEARCH,
    INITIAL_LAUNCH_HASH,
    currentUserId
  );
  if (fromInitialUrl) {
    persistDetectedReferrer(fromInitialUrl);
    return fromInitialUrl;
  }

  // Priority C: Persisted pending referrer in session/localStorage
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

/**
 * Generates the user's unique Telegram Mini App referral invite link:
 * https://t.me/<bot_username>?startapp=ref_<userId>
 */
export function buildReferralLink(
  userId: string,
  botUsername = 'KittyMedallion_bot',
  appShortName = ''
): string {
  const cleanBot = botUsername.replace(/^@/, '');
  if (appShortName) {
    return `https://t.me/${cleanBot}/${appShortName}?startapp=ref_${userId}`;
  }
  return `https://t.me/${cleanBot}?startapp=ref_${userId}`;
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

// ============================================================================
// 3. ATOMIC REFERRAL ATTRIBUTION & SERVICE METHODS
// ============================================================================

const getInitDataHeader = () => {
  if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
    return window.Telegram.WebApp.initData || '';
  }
  return '';
};

const callBackendApi = async (path: string, options: RequestInit = {}) => {
  const initData = getInitDataHeader();
  const effectiveUser = getEffectiveTelegramUser();
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer tma ${initData}`,
      'X-Telegram-Init-Data': initData,
      'X-Telegram-User': encodeURIComponent(JSON.stringify(effectiveUser)),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error(errBody.error || `HTTP ${response.status}`);
  }
  const data = await response.json();
  if (data && data.user && data.user.id) {
    notifyUserUpdated(data.user);
  }
  return data;
};

// Client-side memory cache for Referral Hub
const myReferralsClientCache = new Map<
  string,
  { data: ReferralRecord[]; expiresAt: number }
>();

export const referralService = {
  /**
   * Executes the atomic referral attribution:
   * Works both for brand-new users AND existing users who entered the app previously without a referral link!
   */
  processReferral: async (params: {
    currentUserId: string;
    currentUserFirstName: string;
    currentUserLastName?: string;
    currentUserUsername?: string;
    rawReferrerParam?: string | null;
  }) => {
    const {
      currentUserId,
      currentUserFirstName,
      currentUserLastName = '',
      currentUserUsername = '',
      rawReferrerParam,
    } = params;

    const referrerId = sanitizeReferrerId(rawReferrerParam, currentUserId);
    if (!referrerId) {
      return { applied: false, reason: 'no_valid_referrer' };
    }

    myReferralsClientCache.delete(referrerId);
    myReferralsClientCache.delete(currentUserId);

    try {
      const clientCachedUser = getClientCachedUser(currentUserId);
      const res = await callBackendApi('/referrals/process', {
        method: 'POST',
        body: JSON.stringify({ referrerId, clientCachedUser }),
      });
      if (res?.applied || res?.welcomeGiftGranted || hasValidReferrer(res?.user, currentUserId)) {
        clearPendingReferrer();
      }
      if (res?.applied || res?.welcomeGiftGranted) {
        try {
          window.dispatchEvent(
            new CustomEvent('kitty:referral-gift-unlocked', {
              detail: {
                amountUsdt: REFERRAL_CONFIG.WELCOME_BONUS_USDT,
                amountKitty: REFERRAL_CONFIG.WELCOME_BONUS,
                referrerId,
              },
            })
          );
        } catch {}
      }
      return res;
    } catch (err) {
      console.warn(
        'Backend processReferral unavailable, executing atomic Firestore runTransaction',
        err
      );

      const referredUserRef = doc(db, 'users', currentUserId);
      const referrerUserRef = doc(db, 'users', referrerId);
      const deterministicId = `${referrerId}_${currentUserId}`;
      const referralRecordRef = doc(db, 'referrals', deterministicId);

      let applied = false;

      await runTransaction(db, async (transaction) => {
        const [referredSnap, referrerSnap] = await Promise.all([
          transaction.get(referredUserRef),
          transaction.get(referrerUserRef),
        ]);

        // Check if current user was already validly referred before
        if (referredSnap.exists()) {
          const existingData = referredSnap.data();
          if (hasValidReferrer(existingData, currentUserId)) {
            return;
          }
        }

        // Prevent circular referral
        if (referrerSnap.exists()) {
          const refData = referrerSnap.data();
          if (
            refData.referredBy === currentUserId ||
            refData.referrerId === currentUserId
          ) {
            return;
          }
        }

        const now = Date.now();
        const fullName =
          `${currentUserFirstName} ${currentUserLastName}`.trim() ||
          currentUserUsername ||
          `Miner #${currentUserId.slice(-4)}`;

        // Step A: Update or Create the referred user's document with +2 USDT & +100 KITTY welcome gift
        if (!referredSnap.exists()) {
          transaction.set(referredUserRef, {
            id: currentUserId,
            firstName: currentUserFirstName,
            lastName: currentUserLastName,
            username: currentUserUsername,
            balanceKitty: REFERRAL_CONFIG.WELCOME_BONUS,
            balanceUsdt: REFERRAL_CONFIG.WELCOME_BONUS_USDT,
            welcomeUsdtGranted: true,
            miningSpeed: REFERRAL_CONFIG.DEFAULT_BASE_SPEED,
            referralCount: 0,
            referralsCount: 0,
            earnedReferralCoins: 0,
            referredBy: referrerId,
            referrerId: referrerId,
            referredAt: now,
            claimedMilestones: [],
            vipExpiresAt: 0,
            lastMiningClaim: now,
            createdAt: now,
          });
        } else {
          transaction.update(referredUserRef, {
            referredBy: referrerId,
            referrerId: referrerId,
            referredAt: now,
            welcomeUsdtGranted: true,
            balanceKitty: increment(REFERRAL_CONFIG.WELCOME_BONUS),
            balanceUsdt: increment(REFERRAL_CONFIG.WELCOME_BONUS_USDT),
          });
        }

        // Step B: Update or Create the referrer's document
        if (!referrerSnap.exists()) {
          transaction.set(referrerUserRef, {
            id: referrerId,
            firstName: `Miner #${referrerId.slice(-4)}`,
            lastName: '',
            username: '',
            balanceKitty: REFERRAL_CONFIG.REFERRER_REWARD,
            balanceUsdt: 0,
            miningSpeed:
              REFERRAL_CONFIG.DEFAULT_BASE_SPEED +
              REFERRAL_CONFIG.REFERRER_SPEED_BOOST,
            referralCount: 1,
            referralsCount: 1,
            earnedReferralCoins: REFERRAL_CONFIG.REFERRER_REWARD,
            referredBy: null,
            referrerId: null,
            claimedMilestones: [],
            vipExpiresAt: 0,
            lastMiningClaim: now,
            createdAt: now,
          });
        } else {
          transaction.update(referrerUserRef, {
            balanceKitty: increment(REFERRAL_CONFIG.REFERRER_REWARD),
            miningSpeed: increment(REFERRAL_CONFIG.REFERRER_SPEED_BOOST),
            referralCount: increment(1),
            referralsCount: increment(1),
            earnedReferralCoins: increment(REFERRAL_CONFIG.REFERRER_REWARD),
          });
        }

        // Step C: Create separate audit record in global "referrals" collection
        transaction.set(referralRecordRef, {
          id: deterministicId,
          referrerId,
          referredId: currentUserId,
          referredName: fullName,
          referredUsername: currentUserUsername || '',
          rewardAmount: REFERRAL_CONFIG.REFERRER_REWARD,
          welcomeBonus: REFERRAL_CONFIG.WELCOME_BONUS,
          speedBoost: REFERRAL_CONFIG.REFERRER_SPEED_BOOST,
          timestamp: now,
        });

        applied = true;
      });

      if (applied) {
        clearPendingReferrer();
        try {
          window.dispatchEvent(
            new CustomEvent('kitty:referral-gift-unlocked', {
              detail: {
                amountUsdt: REFERRAL_CONFIG.WELCOME_BONUS_USDT,
                amountKitty: REFERRAL_CONFIG.WELCOME_BONUS,
                referrerId,
              },
            })
          );
        } catch {}
      }

      return { applied };
    }
  },

  /**
   * Claims a Progressive Milestone reward atomically:
   * Verifies referralsCount >= targetCount and !claimedMilestones.includes(milestoneId)
   */
  claimMilestone: async (userId: string, milestoneId: string) => {
    const milestone = REFERRAL_MILESTONES.find((m) => m.id === milestoneId);
    if (!milestone) {
      throw new Error('Invalid milestone ID');
    }

    try {
      return await callBackendApi('/referrals/claim-milestone', {
        method: 'POST',
        body: JSON.stringify({ milestoneId }),
      });
    } catch (err: any) {
      if (err.message && !err.message.includes('HTTP')) {
        throw err;
      }
      console.warn('Backend claimMilestone fallback to client transaction', err);

      const userRef = doc(db, 'users', userId);
      await runTransaction(db, async (transaction) => {
        const userSnap = await transaction.get(userRef);
        if (!userSnap.exists()) throw new Error('User not found');

        const data = userSnap.data();
        const currentReferrals = Math.max(
          data.referralsCount || 0,
          data.referralCount || 0
        );
        const claimed: string[] = Array.isArray(data.claimedMilestones)
          ? data.claimedMilestones
          : [];

        if (claimed.includes(milestone.id)) {
          throw new Error('Milestone already claimed');
        }
        if (currentReferrals < milestone.targetCount) {
          throw new Error(
            `You need ${milestone.targetCount} referrals to claim this milestone`
          );
        }

        const now = Date.now();
        const currentVipExpiry =
          data.vipExpiresAt && data.vipExpiresAt > now ? data.vipExpiresAt : now;
        const newVipExpiry =
          currentVipExpiry + milestone.vipDays * 24 * 60 * 60 * 1000;

        transaction.update(userRef, {
          balanceKitty: increment(milestone.rewardCoins),
          earnedReferralCoins: increment(milestone.rewardCoins),
          miningSpeed: increment(milestone.speedBoost),
          claimedMilestones: arrayUnion(milestone.id),
          vipExpiresAt: newVipExpiry,
        });
      });

      return {
        success: true,
        milestoneId: milestone.id,
        rewardCoins: milestone.rewardCoins,
        vipDays: milestone.vipDays,
      };
    }
  },

  /**
   * Queries the user's referrals from the backend server ledger (0 Firestore reads!)
   * and automatically reconciles the user's referralsCount, earnedReferralCoins, and balanceKitty.
   */
  getMyReferrals: async (
    userId: string,
    forceRefresh = false
  ): Promise<ReferralRecord[]> => {
    const now = Date.now();
    const cached = myReferralsClientCache.get(userId);
    if (!forceRefresh && cached && cached.expiresAt > now) {
      return cached.data;
    }

    try {
      const res = await callBackendApi(
        forceRefresh ? '/referrals?force=1' : '/referrals'
      );
      if (res && Array.isArray(res.referrals)) {
        myReferralsClientCache.set(userId, {
          data: res.referrals,
          expiresAt: now + 10 * 1000, // 10-second short cache since backend ledger costs 0 Firestore reads
        });
        return res.referrals;
      }
    } catch (err) {
      console.warn(
        'Backend getMyReferrals failed, querying Firestore referrals collection directly',
        err
      );
    }

    try {
      const qFallback = query(
        collection(db, 'referrals'),
        where('referrerId', '==', userId),
        limit(30)
      );
      const snapFallback = await getDocs(qFallback);
      const byReferred = new Map<string, ReferralRecord>();
      for (const d of snapFallback.docs) {
        const data = d.data() as Omit<ReferralRecord, 'id'>;
        const refId = String(data.referredId || d.id);
        if (!byReferred.has(refId)) {
          byReferred.set(refId, {
            id: d.id,
            ...data,
          });
        }
      }
      const items = Array.from(byReferred.values()).sort(
        (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
      );

      myReferralsClientCache.set(userId, {
        data: items,
        expiresAt: now + 30 * 1000,
      });
      return items;
    } catch {
      return cached?.data || [];
    }
  },
};


