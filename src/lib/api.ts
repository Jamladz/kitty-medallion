import { db } from './firebase';
import { 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  collection, 
  query, 
  where, 
  orderBy, 
  increment, 
  runTransaction 
} from 'firebase/firestore';

const getInitData = () => {
  if (typeof window !== 'undefined' && window.Telegram && window.Telegram.WebApp) {
    return window.Telegram.WebApp.initData || '';
  }
  return '';
};

export const getEffectiveTelegramUser = () => {
  if (typeof window !== 'undefined') {
    const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
    if (tgUser && tgUser.id) {
      return {
        id: String(tgUser.id),
        first_name: tgUser.first_name || 'Miner',
        last_name: tgUser.last_name || '',
        username: tgUser.username || ''
      };
    }

    // Also try parsing raw initData if initDataUnsafe was not populated yet
    const rawInit = window.Telegram?.WebApp?.initData;
    if (rawInit) {
      try {
        const userJson = new URLSearchParams(rawInit).get('user');
        if (userJson) {
          const parsed = JSON.parse(userJson);
          if (parsed && parsed.id) {
            return {
              id: String(parsed.id),
              first_name: parsed.first_name || 'Miner',
              last_name: parsed.last_name || '',
              username: parsed.username || ''
            };
          }
        }
      } catch {}
    }

    // Outside Telegram (browser preview): if opened with a referral parameter (?startapp=ref_... or ?ref=...),
    // generate/persist a unique visitor ID per browser tab so testing a referral link doesn't collide with 999999999
    try {
      const search = new URLSearchParams(window.location.search);
      const hasReferralParam = Boolean(
        search.get('startapp') ||
          search.get('ref') ||
          search.get('start') ||
          search.get('tgWebAppStartParam')
      );
      const storedVisitorId = sessionStorage.getItem('kitty_browser_visitor_id');
      if (storedVisitorId) {
        return {
          id: storedVisitorId,
          first_name: 'Invited',
          last_name: `Fren #${storedVisitorId.slice(-4)}`,
          username: `fren_${storedVisitorId.slice(-4)}`
        };
      }
      if (hasReferralParam) {
        const rawRef =
          search.get('startapp') ||
          search.get('ref') ||
          search.get('start') ||
          search.get('tgWebAppStartParam') ||
          '';
        const cleanedRef = rawRef.replace(/^(ref_|r_|ref-|invite_)/i, '').trim();
        // If the main dev user is 999999999 and someone opens a link with ref_999999999 in a tab, assign a distinct test visitor ID
        if (cleanedRef === '999999999') {
          const generatedId = String(Math.floor(100000000 + Math.random() * 800000000));
          sessionStorage.setItem('kitty_browser_visitor_id', generatedId);
          return {
            id: generatedId,
            first_name: 'Invited',
            last_name: `Fren #${generatedId.slice(-4)}`,
            username: `fren_${generatedId.slice(-4)}`
          };
        }
      }
    } catch {}
  }

  return {
    id: '999999999',
    first_name: 'Developer',
    last_name: 'User',
    username: 'dev_user'
  };
};

const getUserId = () => {
  return getEffectiveTelegramUser().id;
};

const fetchApi = async (path: string, options: RequestInit = {}) => {
  const initData = getInitData();
  const effectiveUser = getEffectiveTelegramUser();
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer tma ${initData}`,
    'X-Telegram-Init-Data': initData,
    'X-Telegram-User': encodeURIComponent(JSON.stringify(effectiveUser)),
    ...options.headers,
  };
  
  const response = await fetch(`/api${path}`, { ...options, headers });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
  }
  
  return response.json();
};

export const api = {
  auth: async (referrerId?: string) => {
    try {
      const startParam =
        typeof window !== 'undefined'
          ? window.Telegram?.WebApp?.initDataUnsafe?.start_param || ''
          : '';
      return await fetchApi('/auth', {
        method: 'POST',
        body: JSON.stringify({ referrerId, startParam })
      });
    } catch (err) {
      console.warn('API auth failed, falling back to client-side Firestore authentication', err);
      return { success: true, fallback: true };
    }
  },

  claimMining: async () => {
    try {
      return await fetchApi('/claim-mining', { method: 'POST' });
    } catch (err) {
      console.warn('API claimMining failed, using client fallback', err);
      const userId = getUserId();
      const userRef = doc(db, 'users', userId);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
        throw new Error('User not found');
      }
      const data = userSnap.data();
      const now = Date.now();
      const cycleMs = 24 * 60 * 60 * 1000;
      const lastClaim = data.lastMiningClaim || now;
      const timePassedMs = now - lastClaim;

      if (timePassedMs < cycleMs) {
        throw new Error('24-hour mining cycle has not finished yet');
      }

      const earned = data.miningSpeed || 500;
      await updateDoc(userRef, {
        balanceKitty: increment(earned),
        lastMiningClaim: now
      });
      return { success: true, earned };
    }
  },

  getTasks: async () => {
    try {
      return await fetchApi('/tasks');
    } catch (err) {
      console.warn('API getTasks failed, using client-fallback to query Firestore directly', err);
      const userId = getUserId();
      const tasksSnap = await getDocs(query(collection(db, 'tasks'), where('isActive', '==', true)));
      const completionsSnap = await getDocs(collection(db, 'users', userId, 'task_completions'));
      const completedTaskIds = new Set(completionsSnap.docs.map(d => d.id));
      
      const tasks = tasksSnap.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          isCompleted: completedTaskIds.has(doc.id)
        };
      });
      return { tasks };
    }
  },

  claimTask: async (taskId: string) => {
    try {
      return await fetchApi('/tasks/claim', { method: 'POST', body: JSON.stringify({ taskId }) });
    } catch (err) {
      console.warn('API claimTask failed, using client-fallback for direct Firestore transaction', err);
      const userId = getUserId();
      
      await runTransaction(db, async (transaction) => {
        const taskRef = doc(db, 'tasks', taskId);
        const completionRef = doc(db, 'users', userId, 'task_completions', taskId);
        const userRef = doc(db, 'users', userId);
        
        const taskSnap = await transaction.get(taskRef);
        const compSnap = await transaction.get(completionRef);
        const userSnap = await transaction.get(userRef);
        
        if (!taskSnap.exists()) throw new Error('Task not found');
        if (compSnap.exists()) throw new Error('Already completed');
        if (!userSnap.exists()) throw new Error('User not found');
        
        const task = taskSnap.data();
        transaction.set(completionRef, { completedAt: Date.now() });
        transaction.update(userRef, {
          balanceKitty: increment(task.reward || 0),
          miningSpeed: increment(task.miningBoost || 0)
        });
      });
      return { success: true };
    }
  },

  swap: async (amountUsdt: number) => {
    try {
      return await fetchApi('/swap', { method: 'POST', body: JSON.stringify({ amountUsdt }) });
    } catch (err) {
      console.warn('API swap failed, using client-fallback for direct transaction', err);
      const userId = getUserId();
      const costKitty = amountUsdt * 10000;
      
      await runTransaction(db, async (transaction) => {
        const userRef = doc(db, 'users', userId);
        const userSnap = await transaction.get(userRef);
        if (!userSnap.exists()) throw new Error('User not found');
        
        const balance = userSnap.data().balanceKitty || 0;
        if (balance < costKitty) throw new Error('Insufficient balance');
        
        const swapRef = doc(collection(db, 'swaps'));
        transaction.set(swapRef, {
          userId, amountKitty: costKitty, amountUsdt, timestamp: Date.now()
        });
        transaction.update(userRef, {
          balanceKitty: increment(-costKitty),
          balanceUsdt: increment(amountUsdt)
        });
      });
      return { success: true };
    }
  },

  withdraw: async (amount: number, address: string) => {
    try {
      return await fetchApi('/withdraw', { method: 'POST', body: JSON.stringify({ amount, address }) });
    } catch (err) {
      console.warn('API withdraw failed, using client-fallback for withdrawal logs', err);
      const userId = getUserId();
      
      await runTransaction(db, async (transaction) => {
        const userRef = doc(db, 'users', userId);
        const userSnap = await transaction.get(userRef);
        if (!userSnap.exists()) throw new Error('User not found');
        
        const balance = userSnap.data().balanceUsdt || 0;
        if (balance < amount) throw new Error('Insufficient balance');
        
        const wRef = doc(collection(db, 'withdrawals'));
        transaction.set(wRef, {
          userId, amount, address, status: 'Pending', timestamp: Date.now()
        });
        transaction.update(userRef, {
          balanceUsdt: increment(-amount)
        });
      });
      return { success: true };
    }
  },

  getWithdrawals: async () => {
    try {
      return await fetchApi('/withdrawals');
    } catch (err) {
      console.warn('API getWithdrawals failed, falling back to query Firestore directly', err);
      const userId = getUserId();
      const q = query(
        collection(db, 'withdrawals'),
        where('userId', '==', userId),
        orderBy('timestamp', 'desc')
      );
      const snap = await getDocs(q);
      const withdrawals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      return { withdrawals };
    }
  },

  claimEarlyUser: async () => {
    try {
      return await fetchApi('/early-user/claim', { method: 'POST' });
    } catch (err) {
      console.warn('API claimEarlyUser failed, using client fallback', err);
      const userId = getUserId();
      
      await runTransaction(db, async (transaction) => {
        const stateRef = doc(db, 'system', 'state');
        const earlyRef = doc(db, 'early_users', userId);
        const userRef = doc(db, 'users', userId);
        
        const stateSnap = await transaction.get(stateRef);
        const earlySnap = await transaction.get(earlyRef);
        
        const count = stateSnap.exists() ? stateSnap.data().earlyUsersCount || 0 : 0;
        if (count >= 100) throw new Error('Early user limit reached');
        if (earlySnap.exists()) throw new Error('Already claimed');
        
        transaction.set(earlyRef, { claimedAt: Date.now() });
        transaction.set(stateRef, { earlyUsersCount: count + 1 }, { merge: true });
        transaction.update(userRef, {
          balanceKitty: increment(5000)
        });
      });
      return { success: true };
    }
  },

  getEarlyUserStatus: async () => {
    try {
      return await fetchApi('/early-user/status');
    } catch (err) {
      console.warn('API getEarlyUserStatus failed, using client fallback', err);
      const userId = getUserId();
      const stateSnap = await getDoc(doc(db, 'system', 'state'));
      const count = stateSnap.exists() ? stateSnap.data().earlyUsersCount || 0 : 0;
      
      const earlySnap = await getDoc(doc(db, 'early_users', userId));
      const isClaimed = earlySnap.exists();
      
      return { count, isClaimed };
    }
  },

  getReferrals: async () => {
    try {
      return await fetchApi('/referrals');
    } catch (err) {
      console.warn('API getReferrals failed, using client fallback', err);
      const userId = getUserId();
      const q = query(collection(db, 'users'), where('referrerId', '==', userId));
      const snap = await getDocs(q);
      const referrals = snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            firstName: data.firstName || 'Telegram User',
            lastName: data.lastName || '',
            username: data.username || '',
            miningSpeed: data.miningSpeed || 500,
            joinedAt: data.referredAt || data.createdAt || Date.now()
          };
        })
        .sort((a, b) => b.joinedAt - a.joinedAt);

      const userRef = doc(db, 'users', userId);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const currentCount = userSnap.data()?.referralCount || 0;
        if (referrals.length > currentCount) {
          await updateDoc(userRef, { referralCount: referrals.length });
        }
      }

      return { referrals, count: referrals.length };
    }
  },

  getBotInfo: async () => {
    try {
      return await fetchApi('/bot-info');
    } catch {
      return {
        botUsername:
          (typeof import.meta !== 'undefined' &&
            (import.meta as any).env?.VITE_TELEGRAM_BOT_USERNAME) ||
          'KittyMedallion_bot',
        appShortName:
          (typeof import.meta !== 'undefined' &&
            (import.meta as any).env?.VITE_TELEGRAM_APP_SHORT_NAME) ||
          ''
      };
    }
  }
};
