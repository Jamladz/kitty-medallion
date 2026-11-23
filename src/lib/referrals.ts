import { db } from './firebase';
import { getClientCachedUser, notifyUserUpdated } from './api';
import {
  sanitizeReferrerId,
  clearPendingReferrer,
  detectReferrerOnLaunch,
  buildReferralLink,
  buildTelegramShareUrl,
  getTelegramInitData,
  getEffectiveTelegramUser,
  triggerTelegramHaptic,
} from './telegram';
import {
  REFERRAL_CONFIG,
  REFERRAL_MILESTONES,
  getMilestoneById,
  evaluateMilestoneProgress,
  calculateNextVipExpiry,
  calculateTotalReferralStats,
} from './rewardsEngine';
import {
  ReferralMilestone,
  ReferralRecord,
  ProcessReferralParams,
  ProcessReferralResult,
  MilestoneClaimResult,
} from '../types';
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

export {
  REFERRAL_CONFIG,
  REFERRAL_MILESTONES,
  sanitizeReferrerId,
  clearPendingReferrer,
  detectReferrerOnLaunch,
  buildReferralLink,
  buildTelegramShareUrl,
  getMilestoneById,
  evaluateMilestoneProgress,
  calculateNextVipExpiry,
  calculateTotalReferralStats,
  triggerTelegramHaptic,
};

export type {
  ReferralMilestone,
  ReferralRecord,
  ProcessReferralParams,
  ProcessReferralResult,
  MilestoneClaimResult,
};

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

const callBackendApi = async (path: string, options: RequestInit = {}) => {
  const initData = getTelegramInitData();
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

const myReferralsClientCache = new Map<
  string,
  { data: ReferralRecord[]; expiresAt: number }
>();

export const referralService = {
  /**
   * Executes the atomic referral attribution:
   * - Credits +2.00 USDT & +100 KITTY Welcome Gift to the invited user (whether brand new or previously unreferred)
   * - Credits +250 KITTY & +50/24h speed boost + +1 referralsCount to the inviter
   * - Creates an audit record in the "referrals" collection
   */
  processReferral: async (
    params: ProcessReferralParams
  ): Promise<ProcessReferralResult> => {
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
      if (
        res?.applied ||
        res?.welcomeGiftGranted ||
        hasValidReferrer(res?.user, currentUserId)
      ) {
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

        if (referredSnap.exists()) {
          const existingData = referredSnap.data();
          if (hasValidReferrer(existingData, currentUserId)) {
            return;
          }
        }

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

        transaction.set(referralRecordRef, {
          id: deterministicId,
          referrerId,
          referredId: currentUserId,
          referredName: fullName,
          referredUsername: currentUserUsername || '',
          rewardAmount: REFERRAL_CONFIG.REFERRER_REWARD,
          welcomeBonus: REFERRAL_CONFIG.WELCOME_BONUS,
          welcomeBonusUsdt: REFERRAL_CONFIG.WELCOME_BONUS_USDT,
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

      return { applied, welcomeGiftGranted: applied };
    }
  },

  /**
   * Claims a Progressive Milestone reward atomically:
   * Verifies referralsCount >= targetCount and !claimedMilestones.includes(milestoneId)
   */
  claimMilestone: async (
    userId: string,
    milestoneId: string
  ): Promise<MilestoneClaimResult> => {
    const milestone = getMilestoneById(milestoneId);
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

        const newVipExpiry = calculateNextVipExpiry(
          data.vipExpiresAt,
          milestone.vipDays
        );

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
        speedBoost: milestone.speedBoost,
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
          expiresAt: now + 10 * 1000,
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
