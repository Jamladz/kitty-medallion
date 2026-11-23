import React, { createContext, useContext, useEffect, useState } from 'react';
import { db } from '../lib/firebase';
import { doc, onSnapshot, getDoc, setDoc } from 'firebase/firestore';
import { api, getEffectiveTelegramUser } from '../lib/api';
import {
  detectReferrerOnLaunch,
  clearPendingReferrer,
  hasValidReferrer,
  referralService,
  REFERRAL_CONFIG,
} from '../lib/referralService';

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
      window.localStorage.setItem(`kitty_user_cache_${userId}`, JSON.stringify(data));
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
        setUser(customEvent.detail);
        saveCachedUser(String(customEvent.detail.id), customEvent.detail);
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
      if (detectedRef && !hasValidReferrer(currentCached, userId)) {
        try {
          const refRes = await referralService.processReferral({
            currentUserId: userId,
            currentUserFirstName: firstName,
            currentUserLastName: lastName,
            currentUserUsername: username,
            rawReferrerParam: detectedRef,
          });
          if (refRes?.user) {
            setUser(refRes.user);
            saveCachedUser(userId, refRes.user);
          }
        } catch (err) {
          console.warn('Referral attribution check warning:', err);
        }
      }
    };

    const initAuth = async () => {
      try {
        const webApp = window.Telegram?.WebApp;
        if (webApp) {
          webApp.ready();
          webApp.expand();
          if (
            webApp.isVersionAtLeast &&
            webApp.isVersionAtLeast('8.0') &&
            webApp.requestFullscreen
          ) {
            try {
              webApp.requestFullscreen();
            } catch (e) {
              console.log('Fullscreen not supported', e);
            }
          }
        }

        // Load cached user immediately if available so startup is fast and resilient
        const cached = getCachedUser(userId);
        if (cached) {
          setUser(cached);
        }

        // 1. Detect Referrer ID in exact priority order:
        //    a) Telegram WebApp start_param (initDataUnsafe.start_param / initData)
        //    b) Fallback: query & hash parameters (startapp / ref / start)
        const referrerId = detectReferrerOnLaunch(userId);

        // 2. Authenticate with server (passes cached user so existing unreferred users preserve progress and get referred!)
        let authSuccess = false;
        let serverReferralApplied = false;
        try {
          const authData = await api.auth(referrerId || undefined, cached);
          if (authData && !authData.fallback && authData.user) {
            authSuccess = true;
            serverReferralApplied = Boolean(
              authData.referralApplied ||
                hasValidReferrer(authData.user, userId)
            );
            if (serverReferralApplied) {
              clearPendingReferrer();
            }
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
            setUser(authData.user);
            saveCachedUser(userId, authData.user);
            setLoading(false);
          }
        } catch (apiErr) {
          console.warn(
            'API Authentication warning, checking client-side fallback:',
            apiErr
          );
        }

        // 3. Guarantee referral attribution: even if user entered previously without a link,
        //    if they are not yet validly referred and opened a referral link now, attribute it!
        if (referrerId && !serverReferralApplied) {
          try {
            const refRes = await referralService.processReferral({
              currentUserId: userId,
              currentUserFirstName: firstName,
              currentUserLastName: lastName,
              currentUserUsername: username,
              rawReferrerParam: referrerId,
            });
            if (refRes?.user) {
              setUser(refRes.user);
              saveCachedUser(userId, refRes.user);
            }
          } catch (refErr) {
            console.warn('Client referral processing warning:', refErr);
          }
        } else if (!authSuccess && !cached) {
          try {
            const userDocRef = doc(db, 'users', userId);
            const userDocSnap = await getDoc(userDocRef);
            if (userDocSnap.exists()) {
              const docData = userDocSnap.data();
              setUser(docData);
              saveCachedUser(userId, docData);
            } else {
              const initialUser = buildDefaultUser(
                userId,
                firstName,
                lastName,
                username
              );
              await setDoc(userDocRef, initialUser);
              setUser(initialUser);
              saveCachedUser(userId, initialUser);
            }
          } catch (fsErr) {
            console.warn('Firestore direct read skipped (quota/offline):', fsErr);
            const fallbackUser =
              cached || buildDefaultUser(userId, firstName, lastName, username);
            setUser(fallbackUser);
            saveCachedUser(userId, fallbackUser);
          }
        }

        // 4. Attach single document listener with graceful quota-error handler
        try {
          unsubscribe = onSnapshot(
            doc(db, 'users', userId),
            (docSnap) => {
              if (docSnap.exists()) {
                const liveData = docSnap.data();
                setUser((prev: any) => {
                  // Never let a stale Firestore snapshot overwrite a higher referral count from serverLedger
                  const prevRefs = Math.max(
                    Number(prev?.referralsCount) || 0,
                    Number(prev?.referralCount) || 0
                  );
                  const snapRefs = Math.max(
                    Number(liveData?.referralsCount) || 0,
                    Number(liveData?.referralCount) || 0
                  );
                  if (prev && prevRefs > snapRefs) {
                    return prev;
                  }
                  saveCachedUser(userId, liveData);
                  return liveData;
                });
              }
              setLoading(false);
            },
            (snapErr) => {
              console.warn(
                'Firestore snapshot listener paused (using server ledger / API user state):',
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

    // 5. Re-check referral parameters and sync server ledger when app resumes or URL changes
    const handleAppResumeOrUrlChange = () => {
      if (document.visibilityState === 'hidden') return;
      checkAndProcessReferralIfNeeded();
      // Sync user state with server ledger (0 Firestore reads!) so inviter sees new referrals immediately
      api.getReferrals().catch(() => {});
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
      document.removeEventListener('visibilitychange', handleAppResumeOrUrlChange);
    };
  }, []);

  const refreshMining = async () => {
    try {
      const res = await api.claimMining();
      if (res && res.success) {
        if (res.user) {
          setUser(res.user);
          saveCachedUser(String(res.user.id), res.user);
        } else if (user) {
          const updated = {
            ...user,
            balanceKitty: (user.balanceKitty || 0) + (res.claimed || res.earned || 0),
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

