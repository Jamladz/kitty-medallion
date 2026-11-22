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

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unsubscribe: () => void;

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

        // Resolve user details from Telegram WebApp or browser visitor session
        const effectiveUser = getEffectiveTelegramUser();
        const userId = effectiveUser.id;
        const firstName = effectiveUser.first_name || 'Developer';
        const lastName = effectiveUser.last_name || 'User';
        const username = effectiveUser.username || 'dev_user';

        // 1. Detect Referrer ID in exact priority order:
        //    a) Telegram WebApp start_param (initDataUnsafe.start_param)
        //    b) Fallback: query parameters (startapp / ref / start)
        //    Automatically cleans "ref_" and ignores empty or self-referral
        const referrerId = detectReferrerOnLaunch(userId);

        // 2. Authenticate with server (which verifies Telegram initData signature & runs atomic referral transaction)
        let authSuccess = false;
        let serverReferralApplied = false;
        try {
          const authData = await api.auth(referrerId || undefined);
          if (authData && !authData.fallback) {
            authSuccess = true;
            serverReferralApplied = Boolean(
              authData.referralApplied || authData.user?.referredBy || authData.user?.referrerId
            );
          }
        } catch (apiErr) {
          console.error(
            'API Authentication failed, falling back to direct client-side Firestore transaction',
            apiErr
          );
        }

        // 3. Guarantee referral attribution: if a referrerId was detected and not yet applied, run atomic referralService.processReferral
        if (referrerId && !serverReferralApplied) {
          try {
            await referralService.processReferral({
              currentUserId: userId,
              currentUserFirstName: firstName,
              currentUserLastName: lastName,
              currentUserUsername: username,
              rawReferrerParam: referrerId,
            });
          } catch (refErr) {
            console.error('Referral processing error:', refErr);
          }
        } else if (!authSuccess) {
          const userDocRef = doc(db, 'users', userId);
          const userDocSnap = await getDoc(userDocRef);
          if (!userDocSnap.exists()) {
            const now = Date.now();
            await setDoc(userDocRef, {
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
            });
          }
        }

        // 4. Subscribe to real-time user updates in Firestore
        unsubscribe = onSnapshot(doc(db, 'users', userId), (docSnap) => {
          if (docSnap.exists()) {
            setUser(docSnap.data());
          }
          setLoading(false);
        });
      } catch (err: any) {
        console.error('Failed to initialize auth', err);
        setError(err.message || 'Authentication failed');
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
      await api.claimMining();
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
