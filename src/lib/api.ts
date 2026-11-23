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

export const notifyUserUpdated = (user: any) => {
  if (typeof window === 'undefined' || !user || !user.id) return;
  try {
    window.localStorage.setItem(`kitty_user_cache_${user.id}`, JSON.stringify(user));
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent('kitty:user-updated', { detail: user }));
  } catch {}
};

export const getClientCachedUser = (userId: string) => {
  if (typeof window === 'undefined' || !userId) return null;
  try {
    const raw = window.localStorage.getItem(`kitty_user_cache_${userId}`);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
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

    // Also inspect #tgWebAppData in window.location.hash in case Telegram passed user there
    try {
      const hashStr = window.location.hash.replace(/^#/, '');
      const hashParams = new URLSearchParams(hashStr);
      const tgWebAppData = hashParams.get('tgWebAppData');
      if (tgWebAppData) {
        const userJson = new URLSearchParams(tgWebAppData).get('user');
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
      }
    } catch {}

    // Outside Telegram (browser preview): if opened with a referral parameter (?startapp=ref_... or ?ref=...),
    // generate/persist a unique visitor ID per browser tab if the referrer is 999999999 so testing doesn't self-refer
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
  
  const data = await response.json();
  if (data && data.user && data.user.id) {
    notifyUserUpdated(data.user);
  }
  return data;
};

const STATIC_TASKS = [
  { id: 'telegram_channel', title: 'Join our Telegram Channel', description: 'Stay updated with the latest news.', reward: 1000, miningBoost: 50, type: 'social', isActive: true },
  { id: 'twitter_follow', title: 'Follow us on X (Twitter)', description: 'Follow our official X account.', reward: 500, miningBoost: 20, type: 'social', isActive: true },
  { id: 'home_screen', title: 'Add Kitty Medallion to Home Screen', description: 'Add Kitty Medallion to your phone\'s home screen for faster access and receive a Kitty Medallion reward.', reward: 2000, miningBoost: 100, type: 'home_screen', isActive: true },
  { id: 'watch_ad', title: 'Watch an Ad', description: 'Support the project by watching a short ad.', reward: 500, miningBoost: 10, type: 'monetag', isActive: true }
];

// Client-side memory caches to prevent repeated Firestore reads on tab switching
let clientTasksCache: { tasks: any[]; expiresAt: number } | null = null;
let clientWithdrawalsCache: { withdrawals: any[]; expiresAt: number } | null = null;
let clientEarlyStatusCache: { count: number; isClaimed: boolean; expiresAt: number } | null = null;
let clientBotInfoCache: { botUsername: string; appShortName: string } | null = null;

export const api = {
  auth: async (referrerId?: string, clientCachedUser?: any) => {
    try {
      const startParam =
        typeof window !== 'undefined'
          ? window.Telegram?.WebApp?.initDataUnsafe?.start_param || ''
          : '';
      const userId = getUserId();
      const cached = clientCachedUser || getClientCachedUser(userId);
      return await fetchApi('/auth', {
        method: 'POST',
        body: JSON.stringify({ referrerId, startParam, clientCachedUser: cached })
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

  getTasks: async (forceRefresh = false) => {
    const now = Date.now();
    if (!forceRefresh && clientTasksCache && clientTasksCache.expiresAt > now) {
      return { tasks: clientTasksCache.tasks };
    }

    try {
      const res = await fetchApi('/tasks');
      if (res && Array.isArray(res.tasks)) {
        clientTasksCache = { tasks: res.tasks, expiresAt: now + 3 * 60 * 1000 };
      }
      return res;
    } catch (err) {
      console.warn('API getTasks failed, using client-fallback', err);
      const userId = getUserId();
      const completionsSnap = await getDocs(collection(db, 'users', userId, 'task_completions'));
      const completedTaskIds = new Set(completionsSnap.docs.map(d => d.id));
      
      const tasks = STATIC_TASKS.map(task => ({
        ...task,
        isCompleted: completedTaskIds.has(task.id)
      }));
      clientTasksCache = { tasks, expiresAt: now + 3 * 60 * 1000 };
      return { tasks };
    }
  },

  claimTask: async (taskId: string) => {
    clientTasksCache = null; // Invalidate cache on claim
    try {
      return await fetchApi('/tasks/claim', { method: 'POST', body: JSON.stringify({ taskId }) });
    } catch (err) {
      console.warn('API claimTask failed, using client-fallback for direct Firestore transaction', err);
      const userId = getUserId();
      const staticTask = STATIC_TASKS.find(t => t.id === taskId);
      if (!staticTask) throw new Error('Task not found');
      
      await runTransaction(db, async (transaction) => {
        const completionRef = doc(db, 'users', userId, 'task_completions', taskId);
        const userRef = doc(db, 'users', userId);
        
        const compSnap = await transaction.get(completionRef);
        const userSnap = await transaction.get(userRef);
        
        if (compSnap.exists()) throw new Error('Already completed');
        if (!userSnap.exists()) throw new Error('User not found');
        
        transaction.set(completionRef, { completedAt: Date.now() });
        transaction.update(userRef, {
          balanceKitty: increment(staticTask.reward || 0),
          miningSpeed: increment(staticTask.miningBoost || 0)
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
    clientWithdrawalsCache = null; // Invalidate cache on new withdrawal
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
    const now = Date.now();
    if (clientWithdrawalsCache && clientWithdrawalsCache.expiresAt > now) {
      return { withdrawals: clientWithdrawalsCache.withdrawals };
    }
    try {
      const res = await fetchApi('/withdrawals');
      if (res && Array.isArray(res.withdrawals)) {
        clientWithdrawalsCache = { withdrawals: res.withdrawals, expiresAt: now + 3 * 60 * 1000 };
      }
      return res;
    } catch (err) {
      console.warn('API getWithdrawals failed, falling back to query Firestore directly', err);
      const userId = getUserId();
      const q = query(
        collection(db, 'withdrawals'),
        where('userId', '==', userId),
        orderBy('timestamp', 'desc')
      );
      const snap = await getDocs(q);
      const withdrawals = snap.docs.slice(0, 10).map(d => ({ id: d.id, ...d.data() }));
      clientWithdrawalsCache = { withdrawals, expiresAt: now + 3 * 60 * 1000 };
      return { withdrawals };
    }
  },

  claimEarlyUser: async () => {
    clientEarlyStatusCache = null;
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
    const now = Date.now();
    if (clientEarlyStatusCache && clientEarlyStatusCache.expiresAt > now) {
      return {
        count: clientEarlyStatusCache.count,
        isClaimed: clientEarlyStatusCache.isClaimed
      };
    }
    try {
      const res = await fetchApi('/early-user/status');
      if (res && typeof res.count === 'number') {
        clientEarlyStatusCache = {
          count: res.count,
          isClaimed: Boolean(res.isClaimed),
          expiresAt: now + 5 * 60 * 1000
        };
      }
      return res;
    } catch (err) {
      console.warn('API getEarlyUserStatus failed, using client fallback', err);
      const userId = getUserId();
      const stateSnap = await getDoc(doc(db, 'system', 'state'));
      const count = stateSnap.exists() ? stateSnap.data().earlyUsersCount || 0 : 0;
      
      const earlySnap = await getDoc(doc(db, 'early_users', userId));
      const isClaimed = earlySnap.exists();
      
      clientEarlyStatusCache = {
        count,
        isClaimed,
        expiresAt: now + 5 * 60 * 1000
      };
      return { count, isClaimed };
    }
  },

  getReferrals: async () => {
    try {
      return await fetchApi('/referrals');
    } catch (err) {
      console.warn('API getReferrals failed, using client fallback', err);
      const userId = getUserId();
      const q = query(collection(db, 'referrals'), where('referrerId', '==', userId));
      const snap = await getDocs(q);
      const referrals = snap.docs
        .map((d) => ({
          id: d.id,
          ...d.data()
        }))
        .sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));

      return { referrals, count: referrals.length };
    }
  },

  getBotInfo: async () => {
    if (clientBotInfoCache) return clientBotInfoCache;
    try {
      const info = await fetchApi('/bot-info');
      if (info?.botUsername) {
        clientBotInfoCache = info;
      }
      return info;
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
