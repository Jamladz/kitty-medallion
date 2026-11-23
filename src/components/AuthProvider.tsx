import React, { createContext, useContext, useEffect, useState } from 'react';
import { db } from '../lib/firebase';
import { doc, onSnapshot, getDoc, setDoc } from 'firebase/firestore';
import { api, getEffectiveTelegramUser } from '../lib/api';
import {
  detectReferrerOnLaunch,
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
    let unsubscribe: (() => void) | undefined;

    const initAuth = async () => {
      const effectiveUser = getEffectiveTelegramUser();
      const userId = effectiveUser.id;
      const firstName = effectiveUser.first_name || 'Miner';
      const lastName = effectiveUser.last_name || '';
      const username = effectiveUser.username || '';

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
        //    a) Telegram WebApp start_param (initDataUnsafe.start_param)
        //    b) Fallback: query parameters (startapp / ref / start)
        const referrerId = detectReferrerOnLaunch(userId);

        // 2. Authenticate with server (which verifies Telegram initData & runs atomic referral transaction)
        let authSuccess = false;
        let serverReferralApplied = false;
        try {
          const authData = await api.auth(referrerId || undefined);
          if (authData && !authData.fallback && authData.user) {
            authSuccess = true;
            serverReferralApplied = Boolean(
              authData.referralApplied ||
                authData.user?.referredBy ||
                authData.user?.referrerId
            );
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

        // 3. Only hit client-side Firestore transaction if server auth failed AND a new referral needs processing
        if (!authSuccess && referrerId && !serverReferralApplied) {
          try {
            await referralService.processReferral({
              currentUserId: userId,
              currentUserFirstName: firstName,
              currentUserLastName: lastName,
              currentUserUsername: username,
              rawReferrerParam: referrerId,
            });
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
                setUser(liveData);
                saveCachedUser(userId, liveData);
              }
              setLoading(false);
            },
            (snapErr) => {
              console.warn(
                'Firestore snapshot listener paused (using cached/API user state):',
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
        } catch (listenErr) {
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

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const refreshMining = async () => {
    try {
      const res = await api.claimMining();
      if (res && res.success && user) {
        const updated = {
          ...user,
          balanceKitty: (user.balanceKitty || 0) + (res.claimed || 0),
          lastMiningClaim: Date.now(),
        };
        setUser(updated);
        saveCachedUser(String(user.id), updated);
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
