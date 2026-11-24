import React, { createContext, useContext, useEffect, useState } from 'react';
import { db } from '../lib/firebase';
import { doc, onSnapshot, getDoc, setDoc } from 'firebase/firestore';
import { api } from '../lib/api';
import {
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
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore storage errors
  }
  return null;
};

const saveCachedUser = (userId: string, data: any) => {
  try {
    if (data) {
      window.localStorage.setItem(
        `kitty_user_cache_${userId}`,
        JSON.stringify(data)
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
  username: string
) => {
  const now = Date.now();
  return {
    id: userId,
    firstName,
    lastName,
    username,
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

  const primaryRefs = Math.max(
    Number(primary.referralsCount) || 0,
    Number(primary.referralCount) || 0
  );
  const secondaryRefs = Math.max(
    Number(secondary.referralsCount) || 0,
    Number(secondary.referralCount) || 0
  );
  const bestRefs = Math.max(primaryRefs, secondaryRefs);

  const validRef =
    (hasValidReferrer(primary, userId)
      ? primary.referredBy || primary.referrerId
      : null) ||
    (hasValidReferrer(secondary, userId)
      ? secondary.referredBy || secondary.referrerId
      : null) ||
    null;

  return {
    ...secondary,
    ...primary,
    id: userId,
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

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const effectiveUser = getEffectiveTelegramUser();
    const userId = effectiveUser.id;
    const firstName = effectiveUser.first_name || 'Miner';
    const lastName = effectiveUser.last_name || '';
    const username = effectiveUser.username || '';

    const checkAndProcessReferralIfNeeded = async () => {
      const currentCached = getCachedUser(userId);
      const detectedRef = detectReferrerOnLaunch(userId);
      if (detectedRef || !hasValidReferrer(currentCached, userId)) {
        try {
          const refRes = await referralService.processReferral({
            currentUserId: userId,
            currentUserFirstName: firstName,
            currentUserLastName: lastName,
            currentUserUsername: username,
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

        // 1. Detect Referrer ID in exact priority order:
        //    a) Telegram WebApp start_param (initDataUnsafe.start_param / initData)
        //    b) Fallback: query & hash parameters (startapp / ref / start)
        const referrerId = detectReferrerOnLaunch(userId);

        // 2. Execute atomic Firestore referral attribution FIRST (if referrerId detected or pending_referrals exists)
        //    This ensures cross-device Firestore records for BOTH the invited user and the inviter are updated immediately!
        let currentBestUser = cached;
        if (referrerId || !hasValidReferrer(cached, userId)) {
          try {
            const refRes = await referralService.processReferral({
              currentUserId: userId,
              currentUserFirstName: firstName,
              currentUserLastName: lastName,
              currentUserUsername: username,
              rawReferrerParam: referrerId,
            });
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
            currentBestUser = mergeUserSnapshots(
              docData,
              currentBestUser,
              userId
            );
            setUser(currentBestUser);
            saveCachedUser(userId, currentBestUser);
            setLoading(false);
          } else if (!currentBestUser) {
            const initialUser = buildDefaultUser(
              userId,
              firstName,
              lastName,
              username
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
            referrerId || undefined,
            currentBestUser
          );
          if (authData && !authData.fallback && authData.user) {
            if (authData.referralApplied || authData.welcomeGiftGranted) {
              try {
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

    // 7. Re-check referral parameters and reconcile Firestore referrals when app resumes or URL changes
    const handleAppResumeOrUrlChange = () => {
      if (document.visibilityState === 'hidden') return;
      checkAndProcessReferralIfNeeded();
      referralService.getMyReferrals(userId, true).catch(() => {});
    };

    window.addEventListener('focus', handleAppResumeOrUrlChange);
    window.addEventListener('hashchange', handleAppResumeOrUrlChange);
    window.addEventListener('popstate', handleAppResumeOrUrlChange);
    document.addEventListener('visibilitychange', handleAppResumeOrUrlChange);

    return () => {
      if (unsubscribe) unsubscribe();
      window.removeEventListener('focus', handleAppResumeOrUrlChange);
      window.removeEventListener('hashchange', handleAppResumeOrUrlChange);
      window.removeEventListener('popstate', handleAppResumeOrUrlChange);
      document.removeEventListener(
        'visibilitychange',
        handleAppResumeOrUrlChange
      );
    };
  }, []);

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
