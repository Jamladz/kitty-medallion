import React, { createContext, useContext, useEffect, useState } from 'react';
import { db } from '../lib/firebase';
import { doc, onSnapshot, runTransaction, increment } from 'firebase/firestore';
import { api } from '../lib/api';

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
  refreshMining: async () => {}
});

export const useAuth = () => useContext(AuthContext);

/**
 * Extracts a numeric Telegram Referrer ID from all standard Telegram Mini App entry points:
 * 1. window.Telegram.WebApp.initDataUnsafe.start_param
 * 2. URLSearchParams(window.Telegram.WebApp.initData).get('start_param')
 * 3. window.location.search (?tgWebAppStartParam=..., ?startapp=..., ?start=..., ?ref=...)
 * 4. window.location.hash (#tgWebAppStartParam=..., etc.)
 */
export const detectTelegramReferrerId = (): string | undefined => {
  if (typeof window === 'undefined') return undefined;

  const candidates: Array<string | null | undefined> = [];
  const webApp = window.Telegram?.WebApp;

  // 1. Telegram WebApp initDataUnsafe.start_param
  candidates.push(webApp?.initDataUnsafe?.start_param);

  // 2. Raw signed initData query string
  if (webApp?.initData) {
    try {
      const rawParams = new URLSearchParams(webApp.initData);
      candidates.push(rawParams.get('start_param'));
    } catch {}
  }

  // 3. URL search query parameters (?tgWebAppStartParam=ref_123 or ?startapp=ref_123 or ?ref=123)
  try {
    const searchParams = new URLSearchParams(window.location.search);
    candidates.push(
      searchParams.get('tgWebAppStartParam'),
      searchParams.get('startapp'),
      searchParams.get('start_param'),
      searchParams.get('start'),
      searchParams.get('ref')
    );
  } catch {}

  // 4. URL hash parameters (#tgWebAppStartParam=ref_123)
  try {
    const hashStr = window.location.hash.replace(/^#/, '');
    const qIndex = hashStr.indexOf('?');
    const hashQuery = qIndex >= 0 ? hashStr.slice(qIndex + 1) : hashStr;
    const hashParams = new URLSearchParams(hashQuery);
    candidates.push(
      hashParams.get('tgWebAppStartParam'),
      hashParams.get('startapp'),
      hashParams.get('start_param'),
      hashParams.get('ref')
    );
  } catch {}

  for (const raw of candidates) {
    if (!raw) continue;
    const cleaned = String(raw).trim().replace(/^(ref_|r_|ref-|invite_)/i, '');
    if (/^\d+$/.test(cleaned)) {
      return cleaned;
    }
  }

  return undefined;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
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
          if (webApp.isVersionAtLeast && webApp.isVersionAtLeast('8.0') && webApp.requestFullscreen) {
            try {
              webApp.requestFullscreen();
            } catch (e) {
              console.log('Fullscreen not supported', e);
            }
          }
        }

        // Detect referrer from all Telegram start_param sources
        const referrerId = detectTelegramReferrerId();

        // Resolve user details either from WebApp or fallback for testing outside Telegram
        const tgUser = webApp?.initDataUnsafe?.user;
        const userId = tgUser?.id ? String(tgUser.id) : '999999999';
        const firstName = tgUser?.first_name || 'Developer';
        const lastName = tgUser?.last_name || 'User';
        const username = tgUser?.username || 'dev_user';

        // 1. Try to call the API auth
        let authSuccess = false;
        try {
          const authData = await api.auth(referrerId);
          if (authData && !authData.fallback) {
            authSuccess = true;
          }
        } catch (apiErr) {
          console.error('API Authentication failed, falling back to direct client-side Firestore authentication', apiErr);
        }

        // 2. Client-side atomic Firestore fallback (also handles late referral binding if user had no referrer yet)
        if (!authSuccess) {
          const userDocRef = doc(db, 'users', userId);

          await runTransaction(db, async (transaction) => {
            const userDocSnap = await transaction.get(userDocRef);

            let validReferrer: string | null = null;
            if (referrerId && referrerId !== userId) {
              const refDocSnap = await transaction.get(doc(db, 'users', referrerId));
              if (refDocSnap.exists()) {
                const refData = refDocSnap.data();
                if (refData?.referrerId !== userId) {
                  validReferrer = referrerId;
                }
              }
            }

            if (!userDocSnap.exists()) {
              transaction.set(userDocRef, {
                id: userId,
                firstName,
                lastName,
                username,
                balanceKitty: validReferrer ? 100 : 0,
                balanceUsdt: 0,
                miningSpeed: 500,
                referralCount: 0,
                referrerId: validReferrer,
                referredAt: validReferrer ? Date.now() : null,
                lastMiningClaim: Date.now(),
                createdAt: Date.now()
              });

              if (validReferrer) {
                const refUserRef = doc(db, 'users', validReferrer);
                transaction.update(refUserRef, {
                  balanceKitty: increment(100),
                  miningSpeed: increment(50),
                  referralCount: increment(1)
                });
              }
            } else {
              const existingData = userDocSnap.data();
              const updates: Record<string, any> = {
                firstName: firstName || existingData.firstName || '',
                lastName: lastName || existingData.lastName || '',
                username: username || existingData.username || ''
              };

              if (!existingData.referrerId && validReferrer) {
                updates.referrerId = validReferrer;
                updates.referredAt = Date.now();
                updates.balanceKitty = increment(100);

                const refUserRef = doc(db, 'users', validReferrer);
                transaction.update(refUserRef, {
                  balanceKitty: increment(100),
                  miningSpeed: increment(50),
                  referralCount: increment(1)
                });
              }

              transaction.update(userDocRef, updates);
            }
          });
        }

        // Subscribe to user updates in Firestore directly
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
