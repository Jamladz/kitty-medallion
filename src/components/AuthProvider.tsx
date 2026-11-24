import React, { createContext, useContext, useEffect, useState } from 'react';
import { db } from '../lib/firebase';
import { doc, onSnapshot, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { api } from '../lib/api';
import {
  isRealTelegramUserId,
  getEffectiveTelegramUser,
  detectReferrerOnLaunch,
  initTelegramFullscreen,
} from '../lib/telegram';
import { REFERRAL_CONFIG } from '../lib/rewardsEngine';
import { hasValidReferrer, referralService } from '../lib/referrals';

interface AuthContextType {
  user: any;
  loading: boolean;
  error: string | null;
  refreshMining: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  error: null,
  refreshMining: async () => {},
});

export const useAuth = () => useContext(AuthContext);

const getCachedUser = (userId: string) => {
  try {
    const raw = window.localStorage.getItem(`kitty_user_cache_${userId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!isRealTelegramUserId(userId) && parsed) {
        parsed.referredBy = null;
        parsed.referrerId = null;
        parsed.referredAt = null;
      }
      return parsed;
    }
  } catch {
    // ignore storage errors
  }
  return null;
};

const saveCachedUser = (userId: string, data: any) => {
  try {
    if (data) {
      const clean = !isRealTelegramUserId(userId)
        ? { ...data, referredBy: null, referrerId: null, referredAt: null }
        : data;
      window.localStorage.setItem(
        `kitty_user_cache_${userId}`,
        JSON.stringify(clean)
      );
    }
  } catch {
    // ignore storage errors
  }
};

const buildDefaultUser = (
  userId: string,
  firstName: string,
  lastName: string,
  username: string,
  photoUrl = ''
) => {
  const now = Date.now();
  return {
    id: userId,
    firstName,
    lastName,
    username,
    photoUrl,
    balanceKitty: 0,
    balanceUsdt: 0,
    miningSpeed: REFERRAL_CONFIG.DEFAULT_BASE_SPEED,
    referralCount: 0,
    referralsCount: 0,
    earnedReferralCoins: 0,
    referredBy: null,
    referrerId: null,
    referredAt: null,
    claimedMilestones: [],
    vipExpiresAt: 0,
    lastMiningClaim: now,
    createdAt: now,
  };
};

// Safely merge two user snapshots so higher referral counts or balances are never lost
const mergeUserSnapshots = (primary: any, secondary: any, userId: string) => {
  if (!primary && !secondary) return null;
  if (!primary) return secondary;
  if (!secondary) return primary;

  const isRealUser = isRealTelegramUserId(userId);
  const primaryRefs = Math.max(
    Number(primary.referralsCount) || 0,
    Number(primary.referralCount) || 0
  );
  const secondaryRefs = Math.max(
    Number(secondary.referralsCount) || 0,
    Number(secondary.referralCount) || 0
  );
  const bestRefs = Math.max(primaryRefs, secondaryRefs);

  const validRef = isRealUser
    ? (hasValidReferrer(primary, userId)
        ? primary.referredBy || primary.referrerId
        : null) ||
      (hasValidReferrer(secondary, userId)
        ? secondary.referredBy || secondary.referrerId
        : null) ||
      null
    : null;

  const rawLast = String(primary.lastName ?? secondary.lastName ?? '').trim();
  const rawFirst = String(
    primary.firstName || secondary.firstName || ''
  ).trim();
  const cleanLast =
    isRealUser &&
    rawLast.toLowerCase() === 'user' &&
    rawFirst.toLowerCase() !== 'developer'
      ? ''
      : rawLast;

  return {
    ...secondary,
    ...primary,
    id: userId,
    firstName: rawFirst || 'Miner',
    lastName: cleanLast,
    username: primary.username || secondary.username || '',
    photoUrl: primary.photoUrl || secondary.photoUrl || '',
    referralsCount: bestRefs,
    referralCount: bestRefs,
    earnedReferralCoins: Math.max(
      Number(primary.earnedReferralCoins) || 0,
      Number(secondary.earnedReferralCoins) || 0,
      bestRefs * REFERRAL_CONFIG.REFERRER_REWARD
    ),
    balanceKitty: Math.max(
      Number(primary.balanceKitty) || 0,
      Number(secondary.balanceKitty) || 0
    ),
    balanceUsdt: Math.max(
      Number(primary.balanceUsdt) || 0,
      Number(secondary.balanceUsdt) || 0
    ),
    miningSpeed: Math.max(
      Number(primary.miningSpeed) || REFERRAL_CONFIG.DEFAULT_BASE_SPEED,
      Number(secondary.miningSpeed) || REFERRAL_CONFIG.DEFAULT_BASE_SPEED,
      REFERRAL_CONFIG.DEFAULT_BASE_SPEED +
        bestRefs * REFERRAL_CONFIG.REFERRER_SPEED_BOOST
    ),
    referredBy: validRef,
    referrerId: validRef,
    welcomeUsdtGranted: Boolean(
      primary.welcomeUsdtGranted || secondary.welcomeUsdtGranted
    ),
  };
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvedTgUserId, setResolvedTgUserId] = useState<string>(
    () => getEffectiveTelegramUser().id
  );

  useEffect(() => {
    const handleUserUpdatedEvent = (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail && customEvent.detail.id) {
        const incoming = customEvent.detail;
        const uid = String(incoming.id);
        setUser((prev: any) => {
          const merged = mergeUserSnapshots(incoming, prev, uid);
          saveCachedUser(uid, merged);
          return merged;
        });
      }
    };

    window.addEventListener('kitty:user-updated', handleUserUpdatedEvent);
    return () => {
      window.removeEventListener('kitty:user-updated', handleUserUpdatedEvent);
    };
  }, []);

  // Re-check Telegram WebApp user during initial launch window in case mobile WebView bridge populates slightly after mount
  useEffect(() => {
    if (isRealTelegramUserId(resolvedTgUserId)) return;
    const timers = [100, 350, 900, 2000].map((ms) =>
      setTimeout(() => {
        const latest = getEffectiveTelegramUser();
        if (latest?.id && isRealTelegramUserId(latest.id)) {
          setResolvedTgUserId(latest.id);
        }
      }, ms)
    );
    return () => timers.forEach(clearTimeout);
  }, [resolvedTgUserId]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const effectiveUser = getEffectiveTelegramUser();
    const userId = effectiveUser.id;
    const isRealUser = isRealTelegramUserId(userId);
    const firstName = effectiveUser.first_name || 'Miner';
    const rawLast = effectiveUser.last_name || '';
    const lastName =
      isRealUser &&
      rawLast.toLowerCase() === 'user' &&
      firstName.toLowerCase() !== 'developer'
        ? ''
        : rawLast;
    const username = effectiveUser.username || '';
    const photoUrl = effectiveUser.photo_url || '';

    const checkAndProcessReferralIfNeeded = async () => {
      if (!isRealUser) return;
      const currentCached = getCachedUser(userId);
      const detectedRef = detectReferrerOnLaunch(userId);
      if (detectedRef || !hasValidReferrer(currentCached, userId)) {
        try {
          const refRes = await referralService.processReferral({
            currentUserId: userId,
            currentUserFirstName: firstName,
            currentUserLastName: lastName,
            currentUserUsername: username,
            currentUserPhotoUrl: photoUrl,
            rawReferrerParam: detectedRef,
          });
          if (refRes?.user) {
            setUser((prev: any) => {
              const merged = mergeUserSnapshots(refRes.user, prev, userId);
              saveCachedUser(userId, merged);
              return merged;
            });
          }
        } catch (err) {
          console.warn('Referral attribution check warning:', err);
        }
      }
    };

    const initAuth = async () => {
      try {
        initTelegramFullscreen();

        // Load cached user immediately if available so startup is fast and resilient
        const cached = getCachedUser(userId);
        if (cached) {
          setUser(cached);
        }

        // 1. Detect Referrer ID in exact priority order (only for real Telegram users):
        const referrerId = isRealUser ? detectReferrerOnLaunch(userId) : null;

        // 2. Execute atomic Firestore referral attribution FIRST (if referrerId detected or pending_referrals exists)
        let currentBestUser = cached;
        let referralAppliedNow = false;
        if (isRealUser && (referrerId || !hasValidReferrer(cached, userId))) {
          try {
            const refRes = await referralService.processReferral({
              currentUserId: userId,
              currentUserFirstName: firstName,
              currentUserLastName: lastName,
              currentUserUsername: username,
              currentUserPhotoUrl: photoUrl,
              rawReferrerParam: referrerId,
            });
            if (refRes?.applied) {
              referralAppliedNow = true;
            }
            if (refRes?.user) {
              currentBestUser = mergeUserSnapshots(
                refRes.user,
                currentBestUser,
                userId
              );
              setUser(currentBestUser);
              saveCachedUser(userId, currentBestUser);
              setLoading(false);
            }
          } catch (refErr) {
            console.warn('Initial referral processing warning:', refErr);
          }
        }

        // 3. Read or create user directly in Firestore so we have the true cross-device state
        try {
          const userDocRef = doc(db, 'users', userId);
          const userDocSnap = await getDoc(userDocRef);
          if (userDocSnap.exists()) {
            const docData = userDocSnap.data();
            // If Firestore docData has no referrer and we didn't apply a referral yet in this session,
            // do not let a stale localStorage referredBy mask the unreferred state of this existing account
            if (
              !hasValidReferrer(docData, userId) &&
              !referralAppliedNow &&
              currentBestUser
            ) {
              currentBestUser = {
                ...currentBestUser,
                referredBy: null,
                referrerId: null,
                welcomeUsdtGranted: Boolean(docData.welcomeUsdtGranted),
              };
            }
            currentBestUser = mergeUserSnapshots(
              docData,
              currentBestUser,
              userId
            );

            // Sync real Telegram profile fields (firstName, lastName, username, photoUrl) if updated
            if (
              isRealUser &&
              ((firstName && docData.firstName !== firstName) ||
                docData.lastName !== lastName ||
                (username && docData.username !== username) ||
                (photoUrl && docData.photoUrl !== photoUrl))
            ) {
              const profilePatch: Record<string, any> = {
                firstName,
                lastName,
                username: username || docData.username || '',
              };
              if (photoUrl) profilePatch.photoUrl = photoUrl;
              updateDoc(userDocRef, profilePatch).catch(() => {});
              currentBestUser = { ...currentBestUser, ...profilePatch };
            }

            setUser(currentBestUser);
            saveCachedUser(userId, currentBestUser);
            setLoading(false);

            // If this existing real account still has no referrer in Firestore and a referrer is detected, process it now
            const retryRef = isRealUser
              ? referrerId || detectReferrerOnLaunch(userId)
              : null;
            if (isRealUser && !hasValidReferrer(docData, userId) && retryRef) {
              const retryRes = await referralService.processReferral({
                currentUserId: userId,
                currentUserFirstName: firstName,
                currentUserLastName: lastName,
                currentUserUsername: username,
                currentUserPhotoUrl: photoUrl,
                rawReferrerParam: retryRef,
              });
              if (retryRes?.user) {
                currentBestUser = mergeUserSnapshots(
                  retryRes.user,
                  currentBestUser,
                  userId
                );
                setUser(currentBestUser);
                saveCachedUser(userId, currentBestUser);
              }
            }
          } else if (!currentBestUser) {
            const initialUser = buildDefaultUser(
              userId,
              firstName,
              lastName,
              username,
              photoUrl
            );
            await setDoc(userDocRef, initialUser);
            currentBestUser = initialUser;
            setUser(initialUser);
            saveCachedUser(userId, initialUser);
            setLoading(false);
          }
        } catch (fsErr) {
          console.warn('Firestore direct user read warning:', fsErr);
        }

        // 4. Sync with backend API (passing currentBestUser so backend never overwrites Firestore with stale data)
        try {
          const authData = await api.auth(
            isRealUser ? referrerId || undefined : undefined,
            currentBestUser
          );
          if (authData && !authData.fallback && authData.user) {
            if (
              isRealUser &&
              (authData.referralApplied || authData.welcomeGiftGranted)
            ) {
              try {
                window.localStorage.removeItem(
                  `kitty_usdt_welcome_sheet_claimed_${userId}`
                );
                window.sessionStorage.setItem(
                  `kitty_show_welcome_sheet_${userId}`,
                  '1'
                );
                window.dispatchEvent(
                  new CustomEvent('kitty:referral-gift-unlocked', {
                    detail: {
                      amountUsdt: REFERRAL_CONFIG.WELCOME_BONUS_USDT,
                      amountKitty: REFERRAL_CONFIG.WELCOME_BONUS,
                      referrerId: authData.user.referredBy || referrerId,
                    },
                  })
                );
              } catch {}
            }
            currentBestUser = mergeUserSnapshots(
              currentBestUser,
              authData.user,
              userId
            );
            setUser(currentBestUser);
            saveCachedUser(userId, currentBestUser);
            setLoading(false);
          }
        } catch (apiErr) {
          console.warn('API Authentication sync warning:', apiErr);
        }

        // 5. Reconcile user's own referrals in Firestore (ensures if this user is an inviter, any new referrals are credited immediately!)
        referralService.getMyReferrals(userId, true).catch(() => {});

        // 6. Attach real-time Firestore document listener so inviter sees new referrals live
        try {
          unsubscribe = onSnapshot(
            doc(db, 'users', userId),
            (docSnap) => {
              if (docSnap.exists()) {
                const liveData = docSnap.data();
                setUser((prev: any) => {
                  const merged = mergeUserSnapshots(liveData, prev, userId);
                  saveCachedUser(userId, merged);
                  return merged;
                });
              }
              setLoading(false);
            },
            (snapErr) => {
              console.warn(
                'Firestore snapshot listener paused:',
                snapErr.message
              );
              setUser((prev: any) =>
                prev ||
                getCachedUser(userId) ||
                buildDefaultUser(userId, firstName, lastName, username)
              );
              setLoading(false);
            }
          );
        } catch {
          setUser((prev: any) =>
            prev ||
            getCachedUser(userId) ||
            buildDefaultUser(userId, firstName, lastName, username)
          );
          setLoading(false);
        }
      } catch (err: any) {
        console.warn('Auth initialization fallback activated:', err);
        const fallbackUser =
          getCachedUser(userId) ||
          buildDefaultUser(userId, firstName, lastName, username);
        setUser(fallbackUser);
        setError(null);
        setLoading(false);
      }
    };

    initAuth();

    // 7. Re-check referral parameters during initial launch window and when app resumes, activates in Telegram, or URL changes
    const earlyRefTimers = [450, 1500].map((ms) =>
      setTimeout(() => {
        checkAndProcessReferralIfNeeded();
      }, ms)
    );

    const handleAppResumeOrUrlChange = () => {
      if (document.visibilityState === 'hidden') return;
      checkAndProcessReferralIfNeeded();
      referralService.getMyReferrals(userId, true).catch(() => {});
    };

    window.addEventListener('focus', handleAppResumeOrUrlChange);
    window.addEventListener('hashchange', handleAppResumeOrUrlChange);
    window.addEventListener('popstate', handleAppResumeOrUrlChange);
    document.addEventListener('visibilitychange', handleAppResumeOrUrlChange);
    try {
      window.Telegram?.WebApp?.onEvent?.('activated', handleAppResumeOrUrlChange);
    } catch {}

    return () => {
      earlyRefTimers.forEach(clearTimeout);
      if (unsubscribe) unsubscribe();
      window.removeEventListener('focus', handleAppResumeOrUrlChange);
      window.removeEventListener('hashchange', handleAppResumeOrUrlChange);
      window.removeEventListener('popstate', handleAppResumeOrUrlChange);
      document.removeEventListener(
        'visibilitychange',
        handleAppResumeOrUrlChange
      );
      try {
        window.Telegram?.WebApp?.offEvent?.('activated', handleAppResumeOrUrlChange);
      } catch {}
    };
  }, [resolvedTgUserId]);

  const refreshMining = async () => {
    try {
      const res = await api.claimMining();
      if (res && res.success) {
        if (res.user) {
          setUser((prev: any) => {
            const merged = mergeUserSnapshots(
              res.user,
              prev,
              String(res.user.id)
            );
            saveCachedUser(String(res.user.id), merged);
            return merged;
          });
        } else if (user) {
          const updated = {
            ...user,
            balanceKitty:
              (user.balanceKitty || 0) + (res.claimed || res.earned || 0),
            lastMiningClaim: Date.now(),
          };
          setUser(updated);
          saveCachedUser(String(user.id), updated);
        }
      }
    } catch (e) {
      console.error('Failed to claim mining', e);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, error, refreshMining }}>
      {children}
    </AuthContext.Provider>
  );
};
