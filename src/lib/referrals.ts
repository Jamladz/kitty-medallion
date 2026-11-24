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
  getDoc,
  getDocs,
  deleteDoc,
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
   * Checks if there is a pending referral stored in Firestore (`pending_referrals/{userId}`)
   * captured when the user clicked a Telegram `/start ref_<referrerId>` deep link before tapping the Menu Button.
   */
  checkPendingReferralInFirestore: async (
    currentUserId: string
  ): Promise<string | null> => {
    if (!currentUserId) return null;
    try {
      const pendingRef = doc(db, 'pending_referrals', currentUserId);
      const snap = await getDoc(pendingRef);
      if (snap.exists()) {
        const data = snap.data();
        const refId = sanitizeReferrerId(
          data?.referrerId || data?.inviterId,
          currentUserId
        );
        if (refId) {
          return refId;
        }
      }
    } catch {}
    return null;
  },

  /**
   * Executes the atomic referral attribution directly against Firestore FIRST (primary cross-device source of truth)
   * and synchronizes with the backend server ledger:
   * - Credits +2.00 USDT & +100 KITTY Welcome Gift to the invited user (whether brand new or previously unreferred)
   * - Credits +250 KITTY & +50/24h speed boost + +1 referralsCount to the inviter (the other party)
   * - Creates an immutable audit record in the "referrals" collection (`referrals/{referrerId}_{currentUserId}`)
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

    let referrerId = sanitizeReferrerId(rawReferrerParam, currentUserId);
    if (!referrerId) {
      referrerId = await referralService.checkPendingReferralInFirestore(
        currentUserId
      );
    }
    if (!referrerId) {
      return { applied: false, reason: 'no_valid_referrer' };
    }

    myReferralsClientCache.delete(referrerId);
    myReferralsClientCache.delete(currentUserId);

    const referredUserRef = doc(db, 'users', currentUserId);
    const referrerUserRef = doc(db, 'users', referrerId);
    const deterministicId = `${referrerId}_${currentUserId}`;
    const referralRecordRef = doc(db, 'referrals', deterministicId);

    let applied = false;
    let welcomeGiftGranted = false;
    let updatedUser: any = null;

    // 1. Primary Cross-Device Atomic Firestore Transaction
    try {
      await runTransaction(db, async (transaction) => {
        const [referredSnap, referrerSnap, recordSnap] = await Promise.all([
          transaction.get(referredUserRef),
          transaction.get(referrerUserRef),
          transaction.get(referralRecordRef),
        ]);

        const existingData = referredSnap.exists() ? referredSnap.data() : null;
        let existingValidRef = hasValidReferrer(existingData, currentUserId)
          ? String(existingData?.referredBy || existingData?.referrerId).trim()
          : null;

        // If existingData claims a different referrer, verify that an actual referral record exists in `referrals/{existingValidRef}_{currentUserId}`.
        // If no referral record exists for that old field (e.g. from an incomplete/stale test), allow this real referral to proceed!
        if (existingValidRef && existingValidRef !== referrerId) {
          const prevRecordRef = doc(
            db,
            'referrals',
            `${existingValidRef}_${currentUserId}`
          );
          const prevRecordSnap = await transaction.get(prevRecordRef);
          if (prevRecordSnap.exists()) {
            updatedUser = existingData;
            return;
          }
          // Orphaned referredBy without a referral record -> treat as unreferred
          existingValidRef = null;
        }

        // If already referred by THIS referrer AND the referral record exists AND welcome USDT was granted, we are already done
        if (
          existingValidRef === referrerId &&
          recordSnap.exists() &&
          existingData?.welcomeUsdtGranted
        ) {
          updatedUser = existingData;
          return;
        }

        const now = Date.now();
        const fullName =
          `${currentUserFirstName} ${currentUserLastName}`.trim() ||
          currentUserUsername ||
          existingData?.firstName ||
          `Miner #${currentUserId.slice(-4)}`;

        const grantsWelcomeKitty = !existingValidRef;
        const grantsWelcomeUsdt =
          !existingValidRef || !existingData?.welcomeUsdtGranted;
        const creditsReferrerNow = !recordSnap.exists();

        if (!referredSnap.exists()) {
          const newUserDoc = {
            id: currentUserId,
            firstName: currentUserFirstName || 'Miner',
            lastName: currentUserLastName || '',
            username: currentUserUsername || '',
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
          };
          transaction.set(referredUserRef, newUserDoc);
          updatedUser = newUserDoc;
          welcomeGiftGranted = true;
        } else {
          // Pre-existing account entering via referral link
          const prevKitty = Number(existingData?.balanceKitty) || 0;
          const prevUsdt = Number(existingData?.balanceUsdt) || 0;
          const kittyDelta = grantsWelcomeKitty
            ? REFERRAL_CONFIG.WELCOME_BONUS
            : 0;
          const usdtDelta = grantsWelcomeUsdt
            ? REFERRAL_CONFIG.WELCOME_BONUS_USDT
            : 0;

          const nextKitty = prevKitty + kittyDelta;
          const nextUsdt = prevUsdt + usdtDelta;
          const existingRefs = Math.max(
            Number(existingData?.referralsCount) || 0,
            Number(existingData?.referralCount) || 0
          );

          const updatePayload: Record<string, any> = {
            id: currentUserId,
            firstName:
              currentUserFirstName || existingData?.firstName || 'Miner',
            lastName:
              currentUserLastName || existingData?.lastName || '',
            username:
              currentUserUsername || existingData?.username || '',
            referredBy: referrerId,
            referrerId: referrerId,
            referredAt: existingData?.referredAt || now,
            welcomeUsdtGranted: true,
            balanceKitty: nextKitty,
            balanceUsdt: nextUsdt,
            referralsCount: existingRefs,
            referralCount: existingRefs,
          };

          transaction.update(referredUserRef, updatePayload);
          updatedUser = {
            ...existingData,
            ...updatePayload,
          };
          welcomeGiftGranted = grantsWelcomeKitty || grantsWelcomeUsdt;
        }

        // Credit the Inviter (Other Party) in Firestore
        if (creditsReferrerNow) {
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
            const refData = referrerSnap.data();
            const prevRefCount = Math.max(
              Number(refData.referralsCount) || 0,
              Number(refData.referralCount) || 0
            );
            const nextRefCount = prevRefCount + 1;
            const prevEarned = Math.max(
              Number(refData.earnedReferralCoins) || 0,
              prevRefCount * REFERRAL_CONFIG.REFERRER_REWARD
            );
            const nextEarned = prevEarned + REFERRAL_CONFIG.REFERRER_REWARD;
            const nextRefKitty =
              (Number(refData.balanceKitty) || 0) +
              REFERRAL_CONFIG.REFERRER_REWARD;
            const nextRefSpeed =
              Math.max(
                Number(refData.miningSpeed) ||
                  REFERRAL_CONFIG.DEFAULT_BASE_SPEED,
                REFERRAL_CONFIG.DEFAULT_BASE_SPEED +
                  prevRefCount * REFERRAL_CONFIG.REFERRER_SPEED_BOOST
              ) + REFERRAL_CONFIG.REFERRER_SPEED_BOOST;

            transaction.update(referrerUserRef, {
              balanceKitty: nextRefKitty,
              miningSpeed: nextRefSpeed,
              referralCount: nextRefCount,
              referralsCount: nextRefCount,
              earnedReferralCoins: nextEarned,
            });
          }

          transaction.set(referralRecordRef, {
            id: deterministicId,
            referrerId,
            referredId: currentUserId,
            referredName: fullName,
            referredUsername:
              currentUserUsername || existingData?.username || '',
            rewardAmount: REFERRAL_CONFIG.REFERRER_REWARD,
            welcomeBonus: REFERRAL_CONFIG.WELCOME_BONUS,
            welcomeBonusUsdt: REFERRAL_CONFIG.WELCOME_BONUS_USDT,
            speedBoost: REFERRAL_CONFIG.REFERRER_SPEED_BOOST,
            timestamp: now,
          });
        }

        applied = creditsReferrerNow || welcomeGiftGranted;
      });

      if (applied) {
        clearPendingReferrer();
        deleteDoc(doc(db, 'pending_referrals', currentUserId)).catch(() => {});
        if (updatedUser) {
          notifyUserUpdated(updatedUser);
        }
        if (welcomeGiftGranted) {
          try {
            window.localStorage.removeItem(
              `kitty_usdt_welcome_sheet_claimed_${currentUserId}`
            );
            window.sessionStorage.setItem(
              `kitty_show_welcome_sheet_${currentUserId}`,
              '1'
            );
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

        // Sync with backend server ledger so both Firestore and serverLedger are 100% consistent
        await callBackendApi('/referrals/process', {
          method: 'POST',
          body: JSON.stringify({
            referrerId,
            clientCachedUser: updatedUser,
            alreadyAppliedInFirestore: true,
          }),
        }).catch(() => {});

        return {
          applied: true,
          welcomeGiftGranted,
          user: updatedUser,
        };
      }

      if (updatedUser && hasValidReferrer(updatedUser, currentUserId)) {
        clearPendingReferrer();
        return {
          applied: false,
          welcomeGiftGranted: false,
          user: updatedUser,
          reason: 'already_referred',
        };
      }
    } catch (fsErr) {
      console.warn(
        'Direct Firestore processReferral transaction warning, falling back to backend API:',
        fsErr
      );
    }

    // 2. Fallback to Backend API if client-side Firestore transaction encountered a network/quota error
    try {
      const clientCachedUser = updatedUser || getClientCachedUser(currentUserId);
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
          window.localStorage.removeItem(
            `kitty_usdt_welcome_sheet_claimed_${currentUserId}`
          );
          window.sessionStorage.setItem(
            `kitty_show_welcome_sheet_${currentUserId}`,
            '1'
          );
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
    } catch (apiErr: any) {
      return {
        applied: false,
        reason: apiErr?.message || 'referral_failed',
      };
    }
  },

  /**
   * Claims a Progressive Milestone reward atomically in Firestore and syncs with backend:
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
      const userRef = doc(db, 'users', userId);
      let updatedUserData: any = null;

      await runTransaction(db, async (transaction) => {
        const userSnap = await transaction.get(userRef);
        if (!userSnap.exists()) throw new Error('User not found');

        const data = userSnap.data();
        const currentReferrals = Math.max(
          Number(data.referralsCount) || 0,
          Number(data.referralCount) || 0
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

        updatedUserData = {
          ...data,
          id: userId,
          balanceKitty: (Number(data.balanceKitty) || 0) + milestone.rewardCoins,
          earnedReferralCoins:
            (Number(data.earnedReferralCoins) || 0) + milestone.rewardCoins,
          miningSpeed:
            (Number(data.miningSpeed) || REFERRAL_CONFIG.DEFAULT_BASE_SPEED) +
            milestone.speedBoost,
          claimedMilestones: [...claimed, milestone.id],
          vipExpiresAt: newVipExpiry,
        };
      });

      if (updatedUserData) {
        notifyUserUpdated(updatedUserData);
      }

      callBackendApi('/referrals/claim-milestone', {
        method: 'POST',
        body: JSON.stringify({ milestoneId }),
      }).catch(() => {});

      return {
        success: true,
        milestoneId: milestone.id,
        rewardCoins: milestone.rewardCoins,
        speedBoost: milestone.speedBoost,
        vipDays: milestone.vipDays,
      };
    } catch (err: any) {
      if (
        err?.message?.includes('already claimed') ||
        err?.message?.includes('You need')
      ) {
        throw err;
      }
      return await callBackendApi('/referrals/claim-milestone', {
        method: 'POST',
        body: JSON.stringify({ milestoneId }),
      });
    }
  },

  /**
   * Queries the user's referrals directly from Firestore `referrals` collection (cross-device shared truth)
   * AND merges with any backend ledger referrals, then automatically reconciles the inviter's
   * `referralsCount`, `earnedReferralCoins`, `balanceKitty` (+250/ref), and `miningSpeed` (+50/ref)
   * in Firestore if any referral was not yet reflected on their user document!
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

    const byReferred = new Map<string, ReferralRecord>();

    // 1. Primary Query: Firestore `referrals` collection (cross-device source of truth)
    try {
      const qFirestore = query(
        collection(db, 'referrals'),
        where('referrerId', '==', userId),
        limit(50)
      );
      const snap = await getDocs(qFirestore);
      for (const d of snap.docs) {
        const data = d.data() as Omit<ReferralRecord, 'id'>;
        const refId = String(data.referredId || d.id);
        if (!byReferred.has(refId)) {
          byReferred.set(refId, {
            id: d.id,
            ...data,
          });
        }
      }

      // Also check `users` where `referredBy == userId` or `referrerId == userId` in case a user was linked without a `referrals` doc
      const [referredBySnap, referrerIdSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, 'users'),
            where('referredBy', '==', userId),
            limit(50)
          )
        ),
        getDocs(
          query(
            collection(db, 'users'),
            where('referrerId', '==', userId),
            limit(50)
          )
        ),
      ]);

      const allReferredUserDocs = [
        ...referredBySnap.docs,
        ...referrerIdSnap.docs,
      ];

      for (const uDoc of allReferredUserDocs) {
        const uData = uDoc.data();
        const refId = String(uData.id || uDoc.id);
        if (refId && refId !== userId && !byReferred.has(refId)) {
          const fullName =
            `${uData.firstName || ''} ${uData.lastName || ''}`.trim() ||
            uData.username ||
            `Miner #${refId.slice(-4)}`;
          const rec: ReferralRecord = {
            id: `${userId}_${refId}`,
            referrerId: userId,
            referredId: refId,
            referredName: fullName,
            referredUsername: uData.username || '',
            rewardAmount: REFERRAL_CONFIG.REFERRER_REWARD,
            welcomeBonus: REFERRAL_CONFIG.WELCOME_BONUS,
            welcomeBonusUsdt: REFERRAL_CONFIG.WELCOME_BONUS_USDT,
            speedBoost: REFERRAL_CONFIG.REFERRER_SPEED_BOOST,
            timestamp: uData.referredAt || uData.createdAt || now,
          };
          byReferred.set(refId, rec);
        }
      }
    } catch (fsErr) {
      console.warn('Firestore direct referrals query warning:', fsErr);
    }

    // 2. Also merge with backend `/api/referrals`
    try {
      const res = await callBackendApi(
        forceRefresh ? '/referrals?force=1' : '/referrals'
      );
      if (res && Array.isArray(res.referrals)) {
        for (const r of res.referrals) {
          const refId = String(r.referredId || r.id);
          if (refId && !byReferred.has(refId)) {
            byReferred.set(refId, r);
          }
        }
      }
    } catch {}

    const items = Array.from(byReferred.values()).sort(
      (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
    );

    // 3. Reconcile Inviter's User Document in Firestore if `items.length` exceeds stored `referralsCount`
    if (items.length > 0) {
      try {
        const userRef = doc(db, 'users', userId);
        await runTransaction(db, async (transaction) => {
          const userSnap = await transaction.get(userRef);
          if (!userSnap.exists()) return;
          const uData = userSnap.data();
          const storedCount = Math.max(
            Number(uData.referralsCount) || 0,
            Number(uData.referralCount) || 0
          );
          if (items.length > storedCount) {
            const diff = items.length - storedCount;
            const addedCoins = diff * REFERRAL_CONFIG.REFERRER_REWARD;
            const addedSpeed = diff * REFERRAL_CONFIG.REFERRER_SPEED_BOOST;

            transaction.update(userRef, {
              referralsCount: items.length,
              referralCount: items.length,
              earnedReferralCoins: increment(addedCoins),
              balanceKitty: increment(addedCoins),
              miningSpeed: increment(addedSpeed),
            });

            notifyUserUpdated({
              ...uData,
              id: userId,
              referralsCount: items.length,
              referralCount: items.length,
              earnedReferralCoins:
                (Number(uData.earnedReferralCoins) || 0) + addedCoins,
              balanceKitty: (Number(uData.balanceKitty) || 0) + addedCoins,
              miningSpeed:
                (Number(uData.miningSpeed) ||
                  REFERRAL_CONFIG.DEFAULT_BASE_SPEED) + addedSpeed,
            });
          }
        });
      } catch {}
    }

    myReferralsClientCache.set(userId, {
      data: items,
      expiresAt: now + 15 * 1000,
    });
    return items;
  },
};
