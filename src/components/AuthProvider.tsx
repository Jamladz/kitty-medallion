import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, db, signInWithCustomToken } from '../lib/firebase';
import { doc, onSnapshot, getDoc, setDoc, updateDoc, increment } from 'firebase/firestore';
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

        // Get referrer from start param if it exists (e.g., ref_123)
        let referrerId: string | undefined;
        const startParam = webApp?.initDataUnsafe?.start_param;
        if (startParam && startParam.startsWith('ref_')) {
          referrerId = startParam.replace('ref_', '');
        }

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
            console.log('API Authentication successful', authData);
            authSuccess = true;
          }
        } catch (apiErr) {
          console.error('API Authentication failed, falling back to direct client-side Firestore authentication', apiErr);
        }

        // 2. If API auth failed, we do the registration directly from the client side!
        if (!authSuccess) {
          const userDocRef = doc(db, 'users', userId);
          const userDocSnap = await getDoc(userDocRef);

          if (!userDocSnap.exists()) {
            let validReferrer: string | null = null;
            if (referrerId && referrerId !== userId) {
              const refDocSnap = await getDoc(doc(db, 'users', referrerId));
              if (refDocSnap.exists()) {
                validReferrer = referrerId;
              }
            }

            await setDoc(userDocRef, {
              id: userId,
              firstName: firstName,
              lastName: lastName,
              username: username,
              balanceKitty: validReferrer ? 100 : 0,
              balanceUsdt: 0,
              miningSpeed: 500, // base mining 500/day
              referralCount: 0,
              referrerId: validReferrer,
              lastMiningClaim: Date.now(),
              createdAt: Date.now()
            });

            if (validReferrer) {
              const refUserRef = doc(db, 'users', validReferrer);
              await updateDoc(refUserRef, {
                balanceKitty: increment(100),
                miningSpeed: increment(50),
                referralCount: increment(1)
              });
            }
          } else {
            // Auto-claim mining rewards on login just to keep balance fresh
            try {
              const data = userDocSnap.data()!;
              const now = Date.now();
              const timePassedMs = now - data.lastMiningClaim;
              const daysPassed = timePassedMs / (1000 * 60 * 60 * 24);
              if (daysPassed > 0.001) {
                const earned = daysPassed * data.miningSpeed;
                await updateDoc(userDocRef, {
                  balanceKitty: increment(earned),
                  lastMiningClaim: now
                });
              }
            } catch (claimErr) {
              console.error('Client-side auto-claim failed', claimErr);
            }
          }
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
