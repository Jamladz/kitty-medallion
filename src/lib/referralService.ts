import { db } from './firebase';
import { getEffectiveTelegramUser } from './api';
import {
  doc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  onSnapshot,
  runTransaction,
  increment,
  arrayUnion,
} from 'firebase/firestore';

// ============================================================================
// 1. KITTY MEDALLION REFERRAL REWARDS & MILESTONES CONFIGURATION
// ============================================================================

export const REFERRAL_CONFIG = {
  WELCOME_BONUS: 100,        // +100 KITTY instant welcome bonus for the invited friend
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

export interface LeaderboardEntry {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  referralsCount: number;
  earnedReferralCoins: number;
  isCurrentUser: boolean;
  rank: number;
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
  const cleaned = String(rawParam).trim().replace(/^(ref_|r_|ref-|invite_)/i, '').trim();
  if (!cleaned || !/^\d+$/.test(cleaned)) return null;
  if (currentUserId && cleaned === String(currentUserId)) {
    // Self-referral check -> ignore completely
    return null;
  }
  return cleaned;
}

/**
 * Reads the referrer ID on app launch in exact priority order:
 * 1) Telegram WebApp start_param (initDataUnsafe.start_param)
 * 2) Fallback: Page URL query parameters (startapp / ref / start / tgWebAppStartParam)
 */
export function detectReferrerOnLaunch(currentUserId?: string): string | null {
  if (typeof window === 'undefined') return null;

  // Priority A: Telegram WebApp initDataUnsafe.start_param
  const tgStartParam = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
  const fromTelegram = sanitizeReferrerId(tgStartParam, currentUserId);
  if (fromTelegram) {
    try {
      sessionStorage.setItem('kitty_detected_referrer', fromTelegram);
    } catch {}
    return fromTelegram;
  }

  // Priority B: Fallback query parameters from window.location.search & hash
  try {
    const searchParams = new URLSearchParams(window.location.search);
    const queryCandidate =
      searchParams.get('startapp') ||
      searchParams.get('ref') ||
      searchParams.get('start') ||
      searchParams.get('tgWebAppStartParam');

    const fromQuery = sanitizeReferrerId(queryCandidate, currentUserId);
    if (fromQuery) {
      sessionStorage.setItem('kitty_detected_referrer', fromQuery);
      return fromQuery;
    }

    // Check hash params if Telegram client attached them after #
    const hashStr = window.location.hash.replace(/^#/, '');
    const qIdx = hashStr.indexOf('?');
    const hashQuery = new URLSearchParams(qIdx >= 0 ? hashStr.slice(qIdx + 1) : hashStr);
    const hashCandidate =
      hashQuery.get('startapp') ||
      hashQuery.get('ref') ||
      hashQuery.get('start') ||
      hashQuery.get('tgWebAppStartParam');

    const fromHash = sanitizeReferrerId(hashCandidate, currentUserId);
    if (fromHash) {
      sessionStorage.setItem('kitty_detected_referrer', fromHash);
      return fromHash;
    }

    const cached = sessionStorage.getItem('kitty_detected_referrer');
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
  const promoText =
    `🐱🪙 Join me on Kitty Medallion! Mine every 24 hours, climb the Milestone ranks, and get an instant +${REFERRAL_CONFIG.WELCOME_BONUS} KITTY Welcome Bonus when you launch now!`;
  return `https://t.me/share/url?url=${encodeURIComponent(
    referralLink
  )}&text=${encodeURIComponent(promoText)}`;
}

// ============================================================================
// 3. ATOMIC FIRESTORE TRANSACTION & SERVICE METHODS
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
  return response.json();
};

// Client-side memory caches for Referral Hub to avoid repeated Firestore reads
const myReferralsClientCache = new Map<string, { data: ReferralRecord[]; expiresAt: number }>();
let leaderboardClientCache: { data: LeaderboardEntry[]; expiresAt: number } | null = null;

export const referralService = {
  /**
   * Executes the atomic referral attribution:
   * 1. Verifies Telegram initData signature on the backend first.
   * 2. Falls back to the exact client-side Firestore runTransaction if offline/dev:
   *    a) Updates/Creates current user document: sets referredBy = referrerId, grants WELCOME_BONUS (+100) via increment().
   *    b) Updates/Creates referrer document: grants REFERRER_REWARD (+250) + increments referralsCount (+1) + increments earnedReferralCoins (+250).
   *    c) Creates a separate document in global "referrals" collection (auto ID) with referrerId, referredId, referredName, rewardAmount, timestamp.
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
    leaderboardClientCache = null;

    try {
      return await callBackendApi('/referrals/process', {
        method: 'POST',
        body: JSON.stringify({ referrerId }),
      });
    } catch (err) {
      console.warn('Backend processReferral unavailable, executing atomic Firestore runTransaction', err);

      const referredUserRef = doc(db, 'users', currentUserId);
      const referrerUserRef = doc(db, 'users', referrerId);
      const referralRecordRef = doc(collection(db, 'referrals')); // Auto-ID in global "referrals" collection

      let applied = false;

      await runTransaction(db, async (transaction) => {
        const [referredSnap, referrerSnap] = await Promise.all([
          transaction.get(referredUserRef),
          transaction.get(referrerUserRef),
        ]);

        // Check if current user was already referred before (referredBy or referrerId)
        if (referredSnap.exists()) {
          const existingData = referredSnap.data();
          if (existingData.referredBy || existingData.referrerId) {
            return; // Already referred -> prevent duplicate reward
          }
        }

        // Prevent circular referral if referrer exists and was referred by currentUserId
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

        // Step A: Update or Create the referred user's document
        if (!referredSnap.exists()) {
          transaction.set(referredUserRef, {
            id: currentUserId,
            firstName: currentUserFirstName,
            lastName: currentUserLastName,
            username: currentUserUsername,
            balanceKitty: REFERRAL_CONFIG.WELCOME_BONUS,
            balanceUsdt: 0,
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
            balanceKitty: increment(REFERRAL_CONFIG.WELCOME_BONUS),
          });
        }

        // Step B: Update or Create the referrer's document (never ignore if referrer doc doesn't exist yet)
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

        // Step C: Create separate audit record in global "referrals" collection (Auto-ID)
        transaction.set(referralRecordRef, {
          id: referralRecordRef.id,
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
   * Queries the "referrals" collection where('referrerId', '==', userId) ordered descending by timestamp
   * Uses a 2-minute client memory cache to prevent redundant reads on tab navigation.
   */
  getMyReferrals: async (userId: string, forceRefresh = false): Promise<ReferralRecord[]> => {
    const now = Date.now();
    const cached = myReferralsClientCache.get(userId);
    if (!forceRefresh && cached && cached.expiresAt > now) {
      return cached.data;
    }

    try {
      const res = await callBackendApi('/referrals');
      if (res && Array.isArray(res.referrals)) {
        myReferralsClientCache.set(userId, {
          data: res.referrals,
          expiresAt: now + 2 * 60 * 1000,
        });
        return res.referrals;
      }
    } catch (err) {
      console.warn('Backend getMyReferrals failed, querying Firestore referrals collection directly', err);
    }

    try {
      const qFallback = query(
        collection(db, 'referrals'),
        where('referrerId', '==', userId),
        limit(25)
      );
      const snapFallback = await getDocs(qFallback);
      const items = snapFallback.docs
        .map((d) => ({
          id: d.id,
          ...(d.data() as Omit<ReferralRecord, 'id'>),
        }))
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      myReferralsClientCache.set(userId, {
        data: items,
        expiresAt: now + 2 * 60 * 1000,
      });
      return items;
    } catch {
      return [];
    }
  },

  /**
   * Weekly / Top Referrers Leaderboard:
   * Queries "users" ordered descending by referralsCount with a limit, marking isCurrentUser.
   * Cached for 5 minutes on the client so switching tabs costs 0 reads!
   */
  getLeaderboard: async (
    currentUserId: string,
    maxLimit = 10
  ): Promise<LeaderboardEntry[]> => {
    const now = Date.now();
    if (leaderboardClientCache && leaderboardClientCache.expiresAt > now) {
      return leaderboardClientCache.data.map((item) => ({
        ...item,
        isCurrentUser: String(item.id) === String(currentUserId),
      }));
    }

    try {
      const res = await callBackendApi(`/referrals/leaderboard?limit=${maxLimit}`);
      if (res && Array.isArray(res.leaderboard)) {
        leaderboardClientCache = {
          data: res.leaderboard,
          expiresAt: now + 5 * 60 * 1000,
        };
        return res.leaderboard;
      }
    } catch (err) {
      console.warn('Backend getLeaderboard failed, querying Firestore directly', err);
    }

    try {
      const q = query(
        collection(db, 'users'),
        orderBy('referralsCount', 'desc'),
        limit(maxLimit)
      );
      const snap = await getDocs(q);
      const list = snap.docs.map((d, index) => {
        const data = d.data();
        const count = Math.max(data.referralsCount || 0, data.referralCount || 0);
        return {
          id: d.id,
          firstName: data.firstName || 'Miner',
          lastName: data.lastName || '',
          username: data.username || '',
          referralsCount: count,
          earnedReferralCoins:
            data.earnedReferralCoins || count * REFERRAL_CONFIG.REFERRER_REWARD,
          isCurrentUser: String(d.id) === String(currentUserId),
          rank: index + 1,
        };
      });
      leaderboardClientCache = {
        data: list,
        expiresAt: now + 5 * 60 * 1000,
      };
      return list;
    } catch {
      return [];
    }
  },
};
