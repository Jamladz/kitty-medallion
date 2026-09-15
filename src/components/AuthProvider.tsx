import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, db, signInWithCustomToken } from '../lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
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
        let referrerId;
        const startParam = webApp?.initDataUnsafe?.start_param;
        if (startParam && startParam.startsWith('ref_')) {
          referrerId = startParam.replace('ref_', '');
        }

        const { token } = await api.auth(referrerId);
        const userCredential = await signInWithCustomToken(auth, token);
        
        unsubscribe = onSnapshot(doc(db, 'users', userCredential.user.uid), (doc) => {
          if (doc.exists()) {
            setUser(doc.data());
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
