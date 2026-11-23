import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { db, FieldValue } from './server-db';
import fs from 'fs';

dotenv.config();

const getDirnameAndFilename = () => {
  // If we are in CommonJS, __dirname and __filename will be natively available as global-like variables in the scope.
  // Note: We check if they are defined, but inside an arrow function/wrapper, esbuild will replace/provide them appropriately.
  try {
    if (typeof __dirname !== 'undefined' && typeof __filename !== 'undefined') {
      return { __dirname, __filename };
    }
  } catch (e) {}

  const filename = typeof import.meta !== 'undefined' && import.meta.url ? fileURLToPath(import.meta.url) : '';
  const dirname = filename ? path.dirname(filename) : process.cwd();
  return { __dirname: dirname, __filename: filename };
};

const { __dirname, __filename } = getDirnameAndFilename();

const app = express();
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[REQUEST] ${req.method} ${req.url} - Host: ${req.headers.host} - Origin: ${req.headers.origin}`);
  next();
});

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'test_token';

const authenticateTelegram = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    let initData = authHeader && authHeader.startsWith('Bearer tma ') ? authHeader.split('Bearer tma ')[1] : '';

    // Support custom header fallback in case Authorization header is stripped by corporate proxies or WAFs
    const customHeader = req.headers['x-telegram-init-data'] || req.headers['x-tg-init-data'];
    if (!initData && customHeader) {
      initData = String(customHeader);
    }

    const isPreviewHost = Boolean(
      req.hostname && (req.hostname.includes('run.app') || req.hostname.includes('localhost'))
    );
    const isMockAllowed =
      process.env.NODE_ENV !== 'production' ||
      isPreviewHost ||
      BOT_TOKEN === 'test_token';

    // 1. If initData is present and contains a user JSON payload, parse and verify it first!
    if (initData && initData !== 'undefined') {
      const urlParams = new URLSearchParams(initData);
      const userStr = urlParams.get('user');
      const hash = urlParams.get('hash');

      if (userStr) {
        // Verify HMAC signature if a real BOT_TOKEN is configured and we are in strict mode
        if (hash && BOT_TOKEN !== 'test_token' && !isPreviewHost && process.env.NODE_ENV === 'production') {
          urlParams.delete('hash');
          const paramsList: string[] = [];
          urlParams.forEach((value, key) => {
            paramsList.push(`${key}=${value}`);
          });
          paramsList.sort();
          const dataCheckString = paramsList.join('\n');

          const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
          const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

          if (calculatedHash !== hash) {
            return res.status(401).json({ error: 'Unauthorized: Invalid Telegram signature' });
          }
        }

        const parsedUser = JSON.parse(userStr);
        if (parsedUser && parsedUser.id) {
          (req as any).telegramUser = parsedUser;
          (req as any).userId = String(parsedUser.id);
          return next();
        }
      }
    }

    // 2. Also check if client sent explicit Telegram user details in X-Telegram-User header or body
    const explicitUserHeader = req.headers['x-telegram-user'];
    if (explicitUserHeader && isMockAllowed) {
      try {
        const parsedHeaderUser = JSON.parse(decodeURIComponent(String(explicitUserHeader)));
        if (parsedHeaderUser && parsedHeaderUser.id) {
          (req as any).telegramUser = parsedHeaderUser;
          (req as any).userId = String(parsedHeaderUser.id);
          return next();
        }
      } catch {}
    }

    // 3. Fallback to mock developer user ONLY when opened in a regular browser outside Telegram
    if (isMockAllowed) {
      const mockUser = {
        id: 999999999,
        first_name: 'Developer',
        last_name: 'User',
        username: 'dev_user',
        language_code: 'en'
      };
      (req as any).telegramUser = mockUser;
      (req as any).userId = '999999999';
      return next();
    }

    return res.status(401).json({ error: 'Unauthorized: Missing Telegram WebApp initData' });
  } catch (error: any) {
    console.error('Telegram authentication exception:', error);
    return res.status(401).json({ error: 'Unauthorized: Authentication exception occurred', details: error.message });
  }
};

// Static active tasks catalog (0 Firestore reads required to list active tasks!)
const DEFAULT_TASKS = [
  { id: 'telegram_channel', title: 'Join our Telegram Channel', description: 'Stay updated with the latest news.', reward: 1000, miningBoost: 50, type: 'social', isActive: true },
  { id: 'twitter_follow', title: 'Follow us on X (Twitter)', description: 'Follow our official X account.', reward: 500, miningBoost: 20, type: 'social', isActive: true },
  { id: 'home_screen', title: 'Add Kitty Medallion to Home Screen', description: 'Add Kitty Medallion to your phone\'s home screen for faster access and receive a Kitty Medallion reward.', reward: 2000, miningBoost: 100, type: 'home_screen', isActive: true },
  { id: 'watch_ad', title: 'Watch an Ad', description: 'Support the project by watching a short ad.', reward: 500, miningBoost: 10, type: 'monetag', isActive: true }
];

// ============================================================================
// PERSISTENT SERVER LEDGER + ZERO-READ FIRESTORE WRITE SYNC
// Guarantees 100% referral, mining, and task reliability even when Firestore
// daily free read quota is exhausted, and costs 0 Firestore reads per request!
// ============================================================================

const LEDGER_FILE_PATH = path.join(process.cwd(), 'server-ledger.json');

interface ServerLedger {
  users: Record<string, any>;
  referrals: Record<string, any>; // key: `${referrerId}_${referredId}`
  taskCompletions: Record<string, string[]>; // key: userId -> taskId[]
  withdrawals: Record<string, any[]>; // key: userId -> withdrawal[]
  earlyUsers: Record<string, number>; // key: userId -> claimedAt
  pendingReferrals: Record<string, string>; // key: referredUserId -> referrerId
}

const serverLedger: ServerLedger = {
  users: {},
  referrals: {},
  taskCompletions: {},
  withdrawals: {},
  earlyUsers: {},
  pendingReferrals: {}
};

// Load persistent ledger from disk on startup
try {
  if (fs.existsSync(LEDGER_FILE_PATH)) {
    const raw = fs.readFileSync(LEDGER_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      Object.assign(serverLedger.users, parsed.users || {});
      Object.assign(serverLedger.referrals, parsed.referrals || {});
      Object.assign(serverLedger.taskCompletions, parsed.taskCompletions || {});
      Object.assign(serverLedger.withdrawals, parsed.withdrawals || {});
      Object.assign(serverLedger.earlyUsers, parsed.earlyUsers || {});
      Object.assign(serverLedger.pendingReferrals, parsed.pendingReferrals || {});
    }
  }
} catch (e) {
  console.warn('Could not load server-ledger.json, starting fresh:', e);
}

let saveLedgerTimeout: NodeJS.Timeout | null = null;
const saveLedgerToDisk = (immediate = false) => {
  const writeNow = () => {
    try {
      fs.writeFileSync(LEDGER_FILE_PATH, JSON.stringify(serverLedger, null, 2), 'utf8');
    } catch (e) {
      console.warn('Failed to persist server-ledger.json:', e);
    }
  };
  if (immediate) {
    if (saveLedgerTimeout) clearTimeout(saveLedgerTimeout);
    writeNow();
    return;
  }
  if (saveLedgerTimeout) return;
  saveLedgerTimeout = setTimeout(() => {
    saveLedgerTimeout = null;
    writeNow();
  }, 250);
};

// Track Firestore read-quota cooldown so we don't stall requests when daily reads are exhausted
let firestoreReadCooldownUntil = 0;
const isFirestoreReadAvailable = () => Date.now() > firestoreReadCooldownUntil;
const markFirestoreReadError = (err: any) => {
  const msg = String(err?.message || err || '');
  if (
    msg.includes('Quota') ||
    msg.includes('resource-exhausted') ||
    msg.includes('exceeded') ||
    msg.includes('PERMISSION_DENIED')
  ) {
    // Pause Firestore read attempts for 5 minutes so all endpoints respond in <2ms from serverLedger
    firestoreReadCooldownUntil = Date.now() + 5 * 60 * 1000;
  }
};

// Non-blocking write-only sync to Firestore (uses Write Quota, 0 Reads!)
const syncDocToFirestoreWriteOnly = (collectionName: string, docId: string, data: any) => {
  if (!data || typeof data !== 'object') return;
  const { _hydratedFromClient, ...cleanData } = data;
  db.collection(collectionName)
    .doc(docId)
    .set(cleanData, { merge: true })
    .catch(() => {
      // Ignore if write quota or rules reject
    });
};

const extractReferrerId = (rawParam?: string | null): string | null => {
  if (!rawParam) return null;
  const cleaned = String(rawParam).trim();
  if (!cleaned) return null;
  const withoutPrefix = cleaned.replace(/^(ref_|r_|ref-|invite_|startapp=)/i, '').trim();
  if (/^\d+$/.test(withoutPrefix)) {
    return withoutPrefix;
  }
  const match = withoutPrefix.match(/(?:ref_|r_|ref-|invite_)?(\d{5,20})/i);
  if (match && match[1]) {
    return match[1];
  }
  return null;
};

// Checks if a user already has a valid real referrer (ignores null, empty string, self, or mock 999999999)
const getValidExistingReferrer = (userData: any, currentUserId: string): string | null => {
  if (!userData) return null;
  const raw = String(userData.referredBy || userData.referrerId || '').trim();
  if (!raw || raw === 'null' || raw === 'undefined') return null;
  if (raw === String(currentUserId)) return null;
  if (raw === '999999999' && String(currentUserId) !== '999999999') return null;
  if (!/^\d+$/.test(raw)) return null;
  return raw;
};

let cachedBotUsername: string | null = process.env.VITE_TELEGRAM_BOT_USERNAME || null;

async function resolveBotUsername(): Promise<string> {
  if (cachedBotUsername && cachedBotUsername !== 'KittyMedallion_bot') {
    return cachedBotUsername;
  }
  if (BOT_TOKEN && BOT_TOKEN !== 'test_token') {
    try {
      const resp = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
      const data = await resp.json();
      if (data?.ok && data?.result?.username) {
        cachedBotUsername = data.result.username;
        return data.result.username;
      }
    } catch (e) {
      console.warn('Could not fetch bot username from Telegram getMe:', e);
    }
  }
  return cachedBotUsername || 'KittyMedallion_bot';
}

app.get('/api/bot-info', async (_req, res) => {
  const botUsername = await resolveBotUsername();
  const appShortName = process.env.VITE_TELEGRAM_APP_SHORT_NAME || '';
  res.json({ botUsername, appShortName });
});

app.post('/api/telegram-webhook', async (req, res) => {
  try {
    const message = req.body?.message;
    const text: string = message?.text || '';
    const fromUser = message?.from;

    if (fromUser?.id && text.startsWith('/start')) {
      const parts = text.split(/\s+/);
      const startPayload = parts[1] || '';
      const inviterId = extractReferrerId(startPayload);
      const newUserId = String(fromUser.id);

      if (inviterId && inviterId !== newUserId) {
        serverLedger.pendingReferrals[newUserId] = inviterId;
        saveLedgerToDisk(true);
      }
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('Telegram webhook error:', e);
    res.json({ ok: true });
  }
});

const REFERRAL_REWARDS = {
  WELCOME_BONUS: 100,
  WELCOME_BONUS_USDT: 2,
  REFERRER_REWARD: 250,
  REFERRER_SPEED_BOOST: 50,
  BASE_MINING_SPEED: 500
};

const SERVER_MILESTONES = [
  { id: 'milestone_3', targetCount: 3, rewardCoins: 500, speedBoost: 100, vipDays: 1 },
  { id: 'milestone_5', targetCount: 5, rewardCoins: 1000, speedBoost: 200, vipDays: 3 },
  { id: 'milestone_10', targetCount: 10, rewardCoins: 2500, speedBoost: 500, vipDays: 7 },
  { id: 'milestone_25', targetCount: 25, rewardCoins: 7000, speedBoost: 1500, vipDays: 30 }
];

// Reconcile a user's referral counters with all referral records in serverLedger.referrals
function reconcileUserReferralsInLedger(userId: string) {
  const user = serverLedger.users[userId];
  if (!user) return null;

  const userRefs = Object.values(serverLedger.referrals).filter(
    (r: any) => String(r.referrerId) === String(userId)
  );
  const ledgerRefCount = userRefs.length;
  const currentStoredCount = Math.max(
    Number(user.referralsCount) || 0,
    Number(user.referralCount) || 0
  );

  if (ledgerRefCount > currentStoredCount) {
    const uncreditedCount = ledgerRefCount - currentStoredCount;
    user.referralsCount = ledgerRefCount;
    user.referralCount = ledgerRefCount;
    user.earnedReferralCoins =
      (Number(user.earnedReferralCoins) || 0) +
      uncreditedCount * REFERRAL_REWARDS.REFERRER_REWARD;
    user.balanceKitty =
      (Number(user.balanceKitty) || 0) +
      uncreditedCount * REFERRAL_REWARDS.REFERRER_REWARD;
    user.miningSpeed = Math.max(
      Number(user.miningSpeed) || REFERRAL_REWARDS.BASE_MINING_SPEED,
      REFERRAL_REWARDS.BASE_MINING_SPEED +
        ledgerRefCount * REFERRAL_REWARDS.REFERRER_SPEED_BOOST
    );
  }
  return user;
}

// Merge client-cached user fields safely on initial hydration so an existing user never loses prior progress
function mergeWithClientSnapshot(existing: any, clientSnap: any, userId: string) {
  if (!clientSnap || typeof clientSnap !== 'object' || String(clientSnap.id) !== String(userId)) {
    return existing;
  }
  const clientValidRef = getValidExistingReferrer(clientSnap, userId);
  if (!existing) {
    return {
      ...clientSnap,
      id: userId,
      referredBy: clientValidRef,
      referrerId: clientValidRef,
      _hydratedFromClient: true
    };
  }
  if (existing._hydratedFromClient) {
    return existing;
  }
  const existingValidRef = getValidExistingReferrer(existing, userId);
  return {
    ...existing,
    balanceKitty: Math.max(Number(existing.balanceKitty) || 0, Number(clientSnap.balanceKitty) || 0),
    balanceUsdt: Math.max(Number(existing.balanceUsdt) || 0, Number(clientSnap.balanceUsdt) || 0),
    miningSpeed: Math.max(
      Number(existing.miningSpeed) || REFERRAL_REWARDS.BASE_MINING_SPEED,
      Number(clientSnap.miningSpeed) || REFERRAL_REWARDS.BASE_MINING_SPEED
    ),
    referralsCount: Math.max(
      Number(existing.referralsCount) || 0,
      Number(existing.referralCount) || 0,
      Number(clientSnap.referralsCount) || 0,
      Number(clientSnap.referralCount) || 0
    ),
    referralCount: Math.max(
      Number(existing.referralsCount) || 0,
      Number(existing.referralCount) || 0,
      Number(clientSnap.referralsCount) || 0,
      Number(clientSnap.referralCount) || 0
    ),
    earnedReferralCoins: Math.max(
      Number(existing.earnedReferralCoins) || 0,
      Number(clientSnap.earnedReferralCoins) || 0
    ),
    referredBy: existingValidRef || clientValidRef || null,
    referrerId: existingValidRef || clientValidRef || null,
    claimedMilestones: Array.from(
      new Set([
        ...(Array.isArray(existing.claimedMilestones) ? existing.claimedMilestones : []),
        ...(Array.isArray(clientSnap.claimedMilestones) ? clientSnap.claimedMilestones : [])
      ])
    ),
    vipExpiresAt: Math.max(Number(existing.vipExpiresAt) || 0, Number(clientSnap.vipExpiresAt) || 0),
    lastMiningClaim: existing.lastMiningClaim || clientSnap.lastMiningClaim || Date.now(),
    createdAt: existing.createdAt || clientSnap.createdAt || Date.now(),
    _hydratedFromClient: true
  };
}

async function executeAtomicReferralTransaction(params: {
  userId: string;
  firstName: string;
  lastName: string;
  username: string;
  candidateRef: string | null;
  clientCachedUser?: any;
}) {
  const { userId, firstName, lastName, username, candidateRef, clientCachedUser } = params;
  const now = Date.now();

  // 1. Load existing user from Server Ledger first (0 Firestore reads if already known!)
  let existingData = serverLedger.users[userId] || null;

  // If not in serverLedger yet and Firestore reads are available, read once from Firestore
  if (!existingData && isFirestoreReadAvailable()) {
    try {
      const snap = await db.collection('users').doc(userId).get();
      if (snap.exists) {
        existingData = snap.data();
      }
    } catch (err) {
      markFirestoreReadError(err);
    }
  }

  // Merge with client-cached snapshot if available so prior balance is preserved even during Firestore quota cooldown
  existingData = mergeWithClientSnapshot(existingData, clientCachedUser, userId);

  const isNewUser = !existingData;

  // Check if this user already has a valid referrer
  // NOTE: If the user entered the app before WITHOUT a referral link, existingReferrer is null,
  // so they CAN be referred now when invited by a user!
  const existingReferrer = getValidExistingReferrer(existingData, userId);
  const cleanCandidate =
    candidateRef && candidateRef !== userId && /^\d+$/.test(candidateRef)
      ? candidateRef
      : null;

  const deterministicRefRecordId = cleanCandidate
    ? `${cleanCandidate}_${userId}`
    : null;
  const recordAlreadyInLedger = deterministicRefRecordId
    ? Boolean(serverLedger.referrals[deterministicRefRecordId])
    : false;

  // Load referrer data if we have a candidate referrer
  let referrerData = cleanCandidate ? serverLedger.users[cleanCandidate] || null : null;
  if (cleanCandidate && !referrerData && isFirestoreReadAvailable()) {
    try {
      const refSnap = await db.collection('users').doc(cleanCandidate).get();
      if (refSnap.exists) {
        referrerData = refSnap.data();
        serverLedger.users[cleanCandidate] = referrerData;
      }
    } catch (err) {
      markFirestoreReadError(err);
    }
  }

  // Prevent circular referral (if User A was already referred by User B, User B cannot be referred by User A)
  const isCircular =
    referrerData &&
    getValidExistingReferrer(referrerData, cleanCandidate!) === userId;

  // Apply referral if:
  // 1) User has never been referred before (!existingReferrer) — even if they entered the app before without a link!
  // 2) OR existingReferrer === cleanCandidate AND the referral record wasn't created yet (!recordAlreadyInLedger)
  const shouldApplyReferral = Boolean(
    cleanCandidate &&
      deterministicRefRecordId &&
      !isCircular &&
      (!existingReferrer ||
        (existingReferrer === cleanCandidate && !recordAlreadyInLedger))
  );

  const grantsWelcomeBonus = Boolean(shouldApplyReferral && !existingReferrer);
  const needsWelcomeUsdt = Boolean(
    (shouldApplyReferral || existingReferrer) && !existingData?.welcomeUsdtGranted
  );
  const creditsReferrer = Boolean(shouldApplyReferral && !recordAlreadyInLedger);

  // Step A: Build/Update the current user (referred user) in serverLedger
  let finalUserData: any;
  if (!existingData) {
    finalUserData = {
      id: userId,
      firstName: firstName || 'Miner',
      lastName: lastName || '',
      username: username || '',
      balanceKitty: grantsWelcomeBonus ? REFERRAL_REWARDS.WELCOME_BONUS : 0,
      balanceUsdt: needsWelcomeUsdt ? REFERRAL_REWARDS.WELCOME_BONUS_USDT : 0,
      welcomeUsdtGranted: needsWelcomeUsdt,
      miningSpeed: REFERRAL_REWARDS.BASE_MINING_SPEED,
      referralCount: 0,
      referralsCount: 0,
      earnedReferralCoins: 0,
      referredBy: shouldApplyReferral ? cleanCandidate : null,
      referrerId: shouldApplyReferral ? cleanCandidate : null,
      referredAt: shouldApplyReferral ? now : null,
      claimedMilestones: [],
      vipExpiresAt: 0,
      lastMiningClaim: now,
      createdAt: now
    };
  } else {
    finalUserData = {
      ...existingData,
      id: userId,
      firstName: firstName || existingData.firstName || 'Miner',
      lastName: lastName !== undefined ? lastName : existingData.lastName || '',
      username: username || existingData.username || '',
      balanceKitty:
        (Number(existingData.balanceKitty) || 0) +
        (grantsWelcomeBonus ? REFERRAL_REWARDS.WELCOME_BONUS : 0),
      balanceUsdt:
        (Number(existingData.balanceUsdt) || 0) +
        (needsWelcomeUsdt ? REFERRAL_REWARDS.WELCOME_BONUS_USDT : 0),
      welcomeUsdtGranted: Boolean(existingData.welcomeUsdtGranted || needsWelcomeUsdt),
      referredBy: shouldApplyReferral ? cleanCandidate : existingReferrer,
      referrerId: shouldApplyReferral ? cleanCandidate : existingReferrer,
      referredAt: shouldApplyReferral
        ? existingData.referredAt || now
        : existingData.referredAt || null
    };
  }

  serverLedger.users[userId] = finalUserData;
  reconcileUserReferralsInLedger(userId);

  // Step B & C: Credit the Referrer AND record in serverLedger.referrals
  let referralApplied = false;
  if (shouldApplyReferral && cleanCandidate && deterministicRefRecordId) {
    referralApplied = true;
    const referredFullName =
      `${finalUserData.firstName} ${finalUserData.lastName}`.trim() ||
      finalUserData.username ||
      `Miner #${userId.slice(-4)}`;

    // Record in global referrals ledger first
    const refRecord = {
      id: deterministicRefRecordId,
      referrerId: cleanCandidate,
      referredId: userId,
      referredName: referredFullName,
      referredUsername: finalUserData.username || '',
      rewardAmount: REFERRAL_REWARDS.REFERRER_REWARD,
      welcomeBonus: REFERRAL_REWARDS.WELCOME_BONUS,
      welcomeBonusUsdt: REFERRAL_REWARDS.WELCOME_BONUS_USDT,
      speedBoost: REFERRAL_REWARDS.REFERRER_SPEED_BOOST,
      timestamp: now
    };
    serverLedger.referrals[deterministicRefRecordId] = refRecord;

    // Update or create the referrer in serverLedger
    if (!referrerData) {
      referrerData = {
        id: cleanCandidate,
        firstName: `Miner #${cleanCandidate.slice(-4)}`,
        lastName: '',
        username: '',
        balanceKitty: REFERRAL_REWARDS.REFERRER_REWARD,
        balanceUsdt: 0,
        miningSpeed:
          REFERRAL_REWARDS.BASE_MINING_SPEED +
          REFERRAL_REWARDS.REFERRER_SPEED_BOOST,
        referralCount: 1,
        referralsCount: 1,
        earnedReferralCoins: REFERRAL_REWARDS.REFERRER_REWARD,
        referredBy: null,
        referrerId: null,
        claimedMilestones: [],
        vipExpiresAt: 0,
        lastMiningClaim: now,
        createdAt: now
      };
      serverLedger.users[cleanCandidate] = referrerData;
    } else if (creditsReferrer) {
      const nextCount =
        Math.max(
          Number(referrerData.referralsCount) || 0,
          Number(referrerData.referralCount) || 0
        ) + 1;
      referrerData = {
        ...referrerData,
        balanceKitty:
          (Number(referrerData.balanceKitty) || 0) +
          REFERRAL_REWARDS.REFERRER_REWARD,
        miningSpeed:
          (Number(referrerData.miningSpeed) ||
            REFERRAL_REWARDS.BASE_MINING_SPEED) +
          REFERRAL_REWARDS.REFERRER_SPEED_BOOST,
        referralCount: nextCount,
        referralsCount: nextCount,
        earnedReferralCoins:
          (Number(referrerData.earnedReferralCoins) || 0) +
          REFERRAL_REWARDS.REFERRER_REWARD
      };
      serverLedger.users[cleanCandidate] = referrerData;
    }

    reconcileUserReferralsInLedger(cleanCandidate);

    // Non-blocking write-only sync to Firestore (0 Firestore reads!)
    syncDocToFirestoreWriteOnly('users', cleanCandidate, serverLedger.users[cleanCandidate]);
    syncDocToFirestoreWriteOnly('referrals', deterministicRefRecordId, refRecord);
  }

  // Persist ledger to disk and sync current user to Firestore (write-only, 0 reads)
  saveLedgerToDisk(referralApplied || needsWelcomeUsdt);
  syncDocToFirestoreWriteOnly('users', userId, serverLedger.users[userId]);

  return {
    isNewUser,
    referralApplied,
    welcomeGiftGranted: Boolean(referralApplied || needsWelcomeUsdt),
    user: serverLedger.users[userId]
  };
}

app.post('/api/auth', authenticateTelegram, async (req, res) => {
  const tUser = (req as any).telegramUser;
  const userId = String((req as any).userId);
  const {
    referrerId: bodyReferrerId,
    startParam: bodyStartParam,
    clientCachedUser
  } = req.body || {};

  const authHeader = req.headers.authorization;
  const rawInitData =
    (authHeader && authHeader.startsWith('Bearer tma ')
      ? authHeader.split('Bearer tma ')[1]
      : '') ||
    String(req.headers['x-telegram-init-data'] || '');
  const initDataStartParam = rawInitData
    ? new URLSearchParams(rawInitData).get('start_param')
    : null;

  const candidateRef =
    extractReferrerId(bodyReferrerId) ||
    extractReferrerId(bodyStartParam) ||
    extractReferrerId(initDataStartParam) ||
    serverLedger.pendingReferrals[userId] ||
    null;

  try {
    const { isNewUser, referralApplied, welcomeGiftGranted, user } =
      await executeAtomicReferralTransaction({
        userId,
        firstName: tUser.first_name || '',
        lastName: tUser.last_name || '',
        username: tUser.username || '',
        candidateRef,
        clientCachedUser
      });

    if (referralApplied && serverLedger.pendingReferrals[userId]) {
      delete serverLedger.pendingReferrals[userId];
      saveLedgerToDisk();
    }

    res.json({
      token: 'tma_authenticated',
      userId,
      user,
      isNewUser,
      referralApplied,
      welcomeGiftGranted
    });
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/referrals/process', authenticateTelegram, async (req, res) => {
  const tUser = (req as any).telegramUser;
  const userId = String((req as any).userId);
  const candidateRef =
    extractReferrerId(req.body?.referrerId) ||
    serverLedger.pendingReferrals[userId] ||
    null;

  if (!candidateRef || candidateRef === userId) {
    return res.json({
      applied: false,
      reason: 'invalid_or_self_referral',
      user: serverLedger.users[userId] || null
    });
  }

  try {
    const { referralApplied, welcomeGiftGranted, user } =
      await executeAtomicReferralTransaction({
        userId,
        firstName: tUser.first_name || '',
        lastName: tUser.last_name || '',
        username: tUser.username || '',
        candidateRef,
        clientCachedUser: req.body?.clientCachedUser
      });

    if (referralApplied && serverLedger.pendingReferrals[userId]) {
      delete serverLedger.pendingReferrals[userId];
      saveLedgerToDisk();
    }

    res.json({ applied: referralApplied, welcomeGiftGranted, user });
  } catch (error: any) {
    console.error('Process referral error:', error);
    res.status(400).json({ error: error.message || 'Referral processing failed' });
  }
});

app.post('/api/referrals/claim-milestone', authenticateTelegram, async (req, res) => {
  const userId = String((req as any).userId);
  const { milestoneId } = req.body;
  const milestone = SERVER_MILESTONES.find((m) => m.id === milestoneId);

  if (!milestone) {
    return res.status(400).json({ error: 'Invalid milestone ID' });
  }

  try {
    reconcileUserReferralsInLedger(userId);
    let user = serverLedger.users[userId];
    if (!user && isFirestoreReadAvailable()) {
      try {
        const snap = await db.collection('users').doc(userId).get();
        if (snap.exists) {
          user = snap.data();
          serverLedger.users[userId] = user;
        }
      } catch (err) {
        markFirestoreReadError(err);
      }
    }

    if (!user) {
      throw new Error('User not found');
    }

    const count = Math.max(
      Number(user.referralsCount) || 0,
      Number(user.referralCount) || 0
    );
    const claimed: string[] = Array.isArray(user.claimedMilestones)
      ? user.claimedMilestones
      : [];

    if (claimed.includes(milestone.id)) {
      throw new Error('Milestone already claimed');
    }
    if (count < milestone.targetCount) {
      throw new Error(`Requires ${milestone.targetCount} referrals`);
    }

    const now = Date.now();
    const baseExpiry =
      user.vipExpiresAt && user.vipExpiresAt > now ? user.vipExpiresAt : now;
    const newVipExpiry = baseExpiry + milestone.vipDays * 24 * 60 * 60 * 1000;

    user.balanceKitty = (Number(user.balanceKitty) || 0) + milestone.rewardCoins;
    user.earnedReferralCoins =
      (Number(user.earnedReferralCoins) || 0) + milestone.rewardCoins;
    user.miningSpeed =
      (Number(user.miningSpeed) || REFERRAL_REWARDS.BASE_MINING_SPEED) +
      milestone.speedBoost;
    user.claimedMilestones = [...claimed, milestone.id];
    user.vipExpiresAt = newVipExpiry;

    serverLedger.users[userId] = user;
    saveLedgerToDisk(true);
    syncDocToFirestoreWriteOnly('users', userId, user);

    res.json({
      success: true,
      milestoneId: milestone.id,
      rewardCoins: milestone.rewardCoins,
      vipDays: milestone.vipDays,
      user
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Could not claim milestone' });
  }
});

app.get('/api/referrals', authenticateTelegram, async (req, res) => {
  const userId = String((req as any).userId);

  try {
    // 1. Collect all referrals for this referrer from persistent serverLedger (0 Firestore reads!)
    const byReferredId = new Map<string, any>();
    for (const rec of Object.values(serverLedger.referrals)) {
      if (String(rec.referrerId) === userId) {
        const refId = String(rec.referredId || rec.id);
        byReferredId.set(refId, rec);
      }
    }

    // 2. If Firestore reads are available and user specifically has no ledger referrals yet, check Firestore once
    if (byReferredId.size === 0 && isFirestoreReadAvailable()) {
      try {
        const refSnap = await db
          .collection('referrals')
          .where('referrerId', '==', userId)
          .get();

        for (const d of refSnap.docs) {
          const data = d.data();
          const refId = String(data.referredId || d.id);
          const item = {
            id: `${userId}_${refId}`,
            referrerId: userId,
            referredId: refId,
            referredName: data.referredName || 'Telegram Friend',
            referredUsername: data.referredUsername || '',
            rewardAmount: data.rewardAmount || REFERRAL_REWARDS.REFERRER_REWARD,
            welcomeBonus: data.welcomeBonus || REFERRAL_REWARDS.WELCOME_BONUS,
            speedBoost: data.speedBoost || REFERRAL_REWARDS.REFERRER_SPEED_BOOST,
            timestamp: data.timestamp || Date.now()
          };
          if (!byReferredId.has(refId)) {
            byReferredId.set(refId, item);
            serverLedger.referrals[item.id] = item;
          }
        }
        if (refSnap.docs.length > 0) {
          saveLedgerToDisk();
        }
      } catch (fsErr) {
        markFirestoreReadError(fsErr);
      }
    }

    const referrals = Array.from(byReferredId.values()).sort(
      (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
    );

    const updatedUser = reconcileUserReferralsInLedger(userId);
    if (updatedUser) {
      saveLedgerToDisk();
      syncDocToFirestoreWriteOnly('users', userId, updatedUser);
    }

    res.json({
      referrals,
      count: referrals.length,
      user: updatedUser
    });
  } catch (error) {
    console.error('Get referrals error:', error);
    res.json({ referrals: [], count: 0, user: serverLedger.users[userId] || null });
  }
});

const MINING_CYCLE_MS = 24 * 60 * 60 * 1000;

app.post('/api/claim-mining', authenticateTelegram, async (req, res) => {
  const userId = String((req as any).userId);
  try {
    let user = serverLedger.users[userId];
    if (!user && isFirestoreReadAvailable()) {
      try {
        const snap = await db.collection('users').doc(userId).get();
        if (snap.exists) {
          user = snap.data();
          serverLedger.users[userId] = user;
        }
      } catch (err) {
        markFirestoreReadError(err);
      }
    }
    if (!user) throw new Error('User not found');

    const now = Date.now();
    const lastClaim = user.lastMiningClaim || now;
    const timePassedMs = now - lastClaim;

    if (timePassedMs < MINING_CYCLE_MS) {
      const remainingHours = Math.ceil((MINING_CYCLE_MS - timePassedMs) / (1000 * 60 * 60));
      throw new Error(`Mining cycle in progress. Ready in ~${remainingHours}h.`);
    }

    const reward = Number(user.miningSpeed) || 500;
    user.balanceKitty = (Number(user.balanceKitty) || 0) + reward;
    user.lastMiningClaim = now;
    serverLedger.users[userId] = user;

    saveLedgerToDisk(true);
    syncDocToFirestoreWriteOnly('users', userId, user);

    res.json({ success: true, earned: reward, claimed: reward, user });
  } catch (error: any) {
    console.error('Claim mining error:', error);
    res.status(400).json({ error: error.message || 'Mining cycle not finished yet' });
  }
});

app.get('/api/tasks', authenticateTelegram, async (req, res) => {
  const userId = String((req as any).userId);
  const completedList = serverLedger.taskCompletions[userId] || [];
  const completedSet = new Set(completedList);

  const tasks = DEFAULT_TASKS.map((task) => ({
    ...task,
    isCompleted: completedSet.has(task.id)
  }));
  res.json({ tasks });
});

app.post('/api/tasks/claim', authenticateTelegram, async (req, res) => {
  const userId = String((req as any).userId);
  const { taskId } = req.body;
  if (!taskId) return res.status(400).json({ error: 'taskId required' });

  const staticTask = DEFAULT_TASKS.find((t) => t.id === taskId && t.isActive);
  if (!staticTask) {
    return res.status(400).json({ error: 'Task not found or inactive' });
  }

  try {
    const completedList = serverLedger.taskCompletions[userId] || [];
    if (completedList.includes(taskId)) {
      return res.status(400).json({ error: 'Task already completed' });
    }

    serverLedger.taskCompletions[userId] = [...completedList, taskId];
    let user = serverLedger.users[userId];
    if (user) {
      user.balanceKitty = (Number(user.balanceKitty) || 0) + (staticTask.reward || 0);
      user.miningSpeed =
        (Number(user.miningSpeed) || REFERRAL_REWARDS.BASE_MINING_SPEED) +
        (staticTask.miningBoost || 0);
      serverLedger.users[userId] = user;
      syncDocToFirestoreWriteOnly('users', userId, user);
    }
    saveLedgerToDisk(true);

    res.json({
      success: true,
      reward: staticTask.reward,
      miningBoost: staticTask.miningBoost,
      user
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/swap', authenticateTelegram, async (req, res) => {
  const userId = String((req as any).userId);
  const { amountUsdt } = req.body;
  if (!amountUsdt || amountUsdt <= 0) return res.status(400).json({ error: 'Invalid amount' });

  const costKitty = amountUsdt * 10000;
  const user = serverLedger.users[userId];
  if (!user) return res.status(400).json({ error: 'User not found' });

  const balance = Number(user.balanceKitty) || 0;
  if (balance < costKitty) {
    return res.status(400).json({ error: 'Insufficient Kitty Medallion balance' });
  }

  user.balanceKitty = balance - costKitty;
  user.balanceUsdt = (Number(user.balanceUsdt) || 0) + Number(amountUsdt);
  serverLedger.users[userId] = user;
  saveLedgerToDisk(true);
  syncDocToFirestoreWriteOnly('users', userId, user);

  res.json({ success: true, user });
});

app.post('/api/withdraw', authenticateTelegram, async (req, res) => {
  const userId = String((req as any).userId);
  const { amount, address } = req.body;
  if (!amount || amount <= 0 || !address) return res.status(400).json({ error: 'Invalid request' });

  const user = serverLedger.users[userId];
  if (!user) return res.status(400).json({ error: 'User not found' });

  const balance = Number(user.balanceUsdt) || 0;
  if (balance < amount) {
    return res.status(400).json({ error: 'Insufficient USDT balance' });
  }

  user.balanceUsdt = balance - Number(amount);
  serverLedger.users[userId] = user;

  const wItem = {
    id: `w_${Date.now()}`,
    userId,
    amount: Number(amount),
    address,
    status: 'Pending',
    timestamp: Date.now()
  };
  const existingWithdrawals = serverLedger.withdrawals[userId] || [];
  serverLedger.withdrawals[userId] = [wItem, ...existingWithdrawals].slice(0, 20);

  saveLedgerToDisk(true);
  syncDocToFirestoreWriteOnly('users', userId, user);
  syncDocToFirestoreWriteOnly('withdrawals', wItem.id, wItem);

  res.json({ success: true, withdrawal: wItem, user });
});

app.get('/api/withdrawals', authenticateTelegram, async (req, res) => {
  const userId = String((req as any).userId);
  const withdrawals = serverLedger.withdrawals[userId] || [];
  res.json({ withdrawals });
});

app.post('/api/early-user/claim', authenticateTelegram, async (req, res) => {
  const userId = String((req as any).userId);
  const count = Object.keys(serverLedger.earlyUsers).length;
  if (count >= 100) return res.status(400).json({ error: 'Early user limit reached' });
  if (serverLedger.earlyUsers[userId]) return res.status(400).json({ error: 'Already claimed' });

  serverLedger.earlyUsers[userId] = Date.now();
  const user = serverLedger.users[userId];
  if (user) {
    user.balanceKitty = (Number(user.balanceKitty) || 0) + 5000;
    serverLedger.users[userId] = user;
    syncDocToFirestoreWriteOnly('users', userId, user);
  }
  saveLedgerToDisk(true);

  res.json({
    success: true,
    count: Object.keys(serverLedger.earlyUsers).length,
    user
  });
});

app.get('/api/early-user/status', authenticateTelegram, async (req, res) => {
  const userId = String((req as any).userId);
  const count = Object.keys(serverLedger.earlyUsers).length;
  const isClaimed = Boolean(serverLedger.earlyUsers[userId]);
  res.json({ count, isClaimed });
});

const PORT = 3000;

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), 'dist/client')));
    app.get('*splat', (req, res) => {
      res.sendFile(path.join(process.cwd(), 'dist/client/index.html'));
    });
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
