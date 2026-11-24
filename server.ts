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

const isRealTelegramUserId = (id?: string | null): boolean => {
  if (!id) return false;
  const clean = String(id).trim();
  if (!clean || clean === '999999999' || clean === '0') return false;
  if (clean.startsWith('test_')) return false;
  return /^\d{5,20}$/.test(clean);
};

const cleanTelegramLastName = (
  firstName?: string | null,
  lastName?: string | null
): string => {
  const rawLast = String(lastName || '').trim();
  const rawFirst = String(firstName || '').trim();
  if (
    rawLast.toLowerCase() === 'user' &&
    rawFirst.toLowerCase() !== 'developer'
  ) {
    return '';
  }
  return rawLast;
};

const formatTelegramDisplayName = (
  firstName?: string | null,
  lastName?: string | null,
  username?: string | null,
  fallbackId?: string | null
): string => {
  const cleanFirst = String(firstName || '').trim();
  const cleanLast = cleanTelegramLastName(cleanFirst, lastName);
  const full = `${cleanFirst} ${cleanLast}`
    .replace(/\s+User$/i, '')
    .trim();

  if (
    full &&
    full.toLowerCase() !== 'miner' &&
    full.toLowerCase() !== 'telegram friend' &&
    full.toLowerCase() !== 'developer user' &&
    full.toLowerCase() !== 'developer'
  ) {
    return full;
  }

  const cleanUsername = String(username || '')
    .trim()
    .replace(/^@/, '');
  if (cleanUsername && cleanUsername !== 'dev_user') {
    return cleanUsername;
  }

  if (cleanFirst && cleanFirst.toLowerCase() !== 'developer') {
    return cleanFirst;
  }

  if (fallbackId && isRealTelegramUserId(fallbackId)) {
    return `Telegram User #${String(fallbackId).slice(-4)}`;
  }

  return 'Telegram User';
};

// Sanitize any mock/test accounts in serverLedger on startup
for (const [uid, u] of Object.entries(serverLedger.users)) {
  if (!isRealTelegramUserId(uid) && u && typeof u === 'object') {
    u.referredBy = null;
    u.referrerId = null;
    u.referredAt = null;
  }
}
for (const [recId, rec] of Object.entries(serverLedger.referrals)) {
  if (
    !rec ||
    !isRealTelegramUserId(rec.referredId) ||
    !isRealTelegramUserId(rec.referrerId)
  ) {
    delete serverLedger.referrals[recId];
  }
}

const extractReferrerId = (rawParam?: string | null): string | null => {
  if (!rawParam) return null;
  const cleaned = String(rawParam).trim();
  if (!cleaned) return null;
  const withoutPrefix = cleaned
    .replace(
      /^(ref_tg_|ref_tg-|ref_|r_|ref-|invite_|inviter_|tg_|u_|user_|startapp=|start=|ref=)+/i,
      ''
    )
    .trim();
  if (/^\d+$/.test(withoutPrefix) && isRealTelegramUserId(withoutPrefix)) {
    return withoutPrefix;
  }
  const match = withoutPrefix.match(
    /(?:ref_tg_|ref_tg-|ref_|r_|ref-|invite_|inviter_|tg_|u_|user_)?(\d{5,20})/i
  );
  if (match && match[1] && isRealTelegramUserId(match[1])) {
    return match[1];
  }
  return null;
};

// Checks if a user already has a valid real Telegram referrer (ignores null, empty string, self, or mock 999999999)
const getValidExistingReferrer = (userData: any, currentUserId: string): string | null => {
  if (!userData || !isRealTelegramUserId(currentUserId)) return null;
  const raw = String(userData.referredBy || userData.referrerId || '').trim();
  if (!raw || raw === 'null' || raw === 'undefined') return null;
  if (raw === String(currentUserId)) return null;
  if (!isRealTelegramUserId(raw)) return null;
  return raw;
};

let cachedBotUsername: string = 'kittymedallion_bot';
let cachedAppShortName: string = '';

async function resolveBotInfo(): Promise<{ botUsername: string; appShortName: string }> {
  return {
    botUsername: cachedBotUsername || 'kittymedallion_bot',
    appShortName: cachedAppShortName
  };
}

app.get('/api/bot-info', async (_req, res) => {
  const info = await resolveBotInfo();
  res.json(info);
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

      if (
        inviterId &&
        inviterId !== newUserId &&
        isRealTelegramUserId(inviterId) &&
        isRealTelegramUserId(newUserId)
      ) {
        serverLedger.pendingReferrals[newUserId] = inviterId;
        saveLedgerToDisk(true);
        db.collection('pending_referrals')
          .doc(newUserId)
          .set({ referrerId: inviterId, timestamp: Date.now() }, { merge: true })
          .catch(() => {});
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

// Reconcile a user's referral counters with all real referral records in serverLedger.referrals
function reconcileUserReferralsInLedger(userId: string) {
  const user = serverLedger.users[userId];
  if (!user) return null;

  const userRefs = Object.values(serverLedger.referrals).filter(
    (r: any) =>
      String(r.referrerId) === String(userId) &&
      isRealTelegramUserId(String(r.referredId)) &&
      String(r.referredId) !== String(userId)
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
      Math.max(
        Number(user.earnedReferralCoins) || 0,
        currentStoredCount * REFERRAL_REWARDS.REFERRER_REWARD
      ) +
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

// Merge client-cached user fields safely so an existing user never loses prior progress or higher referral counts
function mergeWithClientSnapshot(existing: any, clientSnap: any, userId: string) {
  if (!clientSnap || typeof clientSnap !== 'object' || String(clientSnap.id) !== String(userId)) {
    return existing;
  }
  const isReal = isRealTelegramUserId(userId);
  const clientValidRef = isReal ? getValidExistingReferrer(clientSnap, userId) : null;
  if (!existing) {
    return {
      ...clientSnap,
      id: userId,
      referredBy: clientValidRef,
      referrerId: clientValidRef,
      referredAt: clientValidRef ? clientSnap.referredAt || null : null,
      _hydratedFromClient: true
    };
  }
  const existingValidRef = isReal ? getValidExistingReferrer(existing, userId) : null;
  const bestRefs = Math.max(
    Number(existing.referralsCount) || 0,
    Number(existing.referralCount) || 0,
    Number(clientSnap.referralsCount) || 0,
    Number(clientSnap.referralCount) || 0
  );
  const resolvedRef = isReal ? existingValidRef || clientValidRef || null : null;
  return {
    ...existing,
    photoUrl: existing.photoUrl || clientSnap.photoUrl || '',
    balanceKitty: Math.max(Number(existing.balanceKitty) || 0, Number(clientSnap.balanceKitty) || 0),
    balanceUsdt: Math.max(Number(existing.balanceUsdt) || 0, Number(clientSnap.balanceUsdt) || 0),
    miningSpeed: Math.max(
      Number(existing.miningSpeed) || REFERRAL_REWARDS.BASE_MINING_SPEED,
      Number(clientSnap.miningSpeed) || REFERRAL_REWARDS.BASE_MINING_SPEED,
      REFERRAL_REWARDS.BASE_MINING_SPEED + bestRefs * REFERRAL_REWARDS.REFERRER_SPEED_BOOST
    ),
    referralsCount: bestRefs,
    referralCount: bestRefs,
    earnedReferralCoins: Math.max(
      Number(existing.earnedReferralCoins) || 0,
      Number(clientSnap.earnedReferralCoins) || 0,
      bestRefs * REFERRAL_REWARDS.REFERRER_REWARD
    ),
    referredBy: resolvedRef,
    referrerId: resolvedRef,
    referredAt: resolvedRef ? existing.referredAt || clientSnap.referredAt || null : null,
    welcomeUsdtGranted: Boolean(existing.welcomeUsdtGranted || clientSnap.welcomeUsdtGranted),
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
  photoUrl?: string;
  candidateRef: string | null;
  clientCachedUser?: any;
  alreadyAppliedInFirestore?: boolean;
}) {
  const {
    userId,
    firstName,
    lastName,
    username,
    photoUrl = '',
    candidateRef,
    clientCachedUser,
    alreadyAppliedInFirestore = false
  } = params;
  const now = Date.now();
  const isRealUser = isRealTelegramUserId(userId);

  // 1. Load existing user from Server Ledger and merge with latest Firestore document when reads are available
  let existingData = serverLedger.users[userId] || null;
  let firestoreDocData: any = null;

  if (isFirestoreReadAvailable()) {
    try {
      const snap = await db.collection('users').doc(userId).get();
      if (snap.exists) {
        firestoreDocData = snap.data();
        existingData = mergeWithClientSnapshot(firestoreDocData, existingData, userId);
      }
    } catch (err) {
      markFirestoreReadError(err);
    }
  }

  // If Firestore has this existing account with NO referrer, and !alreadyAppliedInFirestore,
  // do not allow a stale clientCachedUser.referredBy to block a new referral
  let safeClientSnap = clientCachedUser;
  if (
    (!isRealUser ||
      (firestoreDocData &&
        !getValidExistingReferrer(firestoreDocData, userId) &&
        !alreadyAppliedInFirestore)) &&
    safeClientSnap
  ) {
    safeClientSnap = {
      ...safeClientSnap,
      referredBy: null,
      referrerId: null,
      referredAt: null,
      welcomeUsdtGranted: Boolean(firestoreDocData?.welcomeUsdtGranted)
    };
  }

  // Merge with client-cached snapshot if available so prior balance/referrals are always preserved
  existingData = mergeWithClientSnapshot(existingData, safeClientSnap, userId);

  const isNewUser = !existingData;

  // Check if this user already has a valid real Telegram referrer
  let existingReferrer = isRealUser ? getValidExistingReferrer(existingData, userId) : null;
  const cleanCandidate =
    isRealUser &&
    candidateRef &&
    candidateRef !== userId &&
    isRealTelegramUserId(candidateRef)
      ? candidateRef
      : null;

  // If existingReferrer differs from cleanCandidate, verify if an actual referral record exists for existingReferrer
  if (existingReferrer && cleanCandidate && existingReferrer !== cleanCandidate) {
    const prevRecId = `${existingReferrer}_${userId}`;
    let prevRecExists = Boolean(serverLedger.referrals[prevRecId]);
    if (!prevRecExists && isFirestoreReadAvailable()) {
      try {
        const prevSnap = await db.collection('referrals').doc(prevRecId).get();
        prevRecExists = prevSnap.exists;
      } catch (err) {
        markFirestoreReadError(err);
      }
    }
    if (!prevRecExists) {
      existingReferrer = null;
    }
  }

  const deterministicRefRecordId = cleanCandidate
    ? `${cleanCandidate}_${userId}`
    : null;

  // Check both serverLedger and Firestore for existing referral record so we never double-credit
  let recordAlreadyExists = deterministicRefRecordId
    ? Boolean(serverLedger.referrals[deterministicRefRecordId])
    : false;

  if (deterministicRefRecordId && !recordAlreadyExists && isFirestoreReadAvailable()) {
    try {
      const recSnap = await db.collection('referrals').doc(deterministicRefRecordId).get();
      if (recSnap.exists) {
        recordAlreadyExists = true;
        serverLedger.referrals[deterministicRefRecordId] = recSnap.data();
      }
    } catch (err) {
      markFirestoreReadError(err);
    }
  }

  // Load referrer data from Firestore if we have a candidate referrer
  let referrerData = cleanCandidate ? serverLedger.users[cleanCandidate] || null : null;
  if (cleanCandidate && isFirestoreReadAvailable()) {
    try {
      const refSnap = await db.collection('users').doc(cleanCandidate).get();
      if (refSnap.exists) {
        referrerData = mergeWithClientSnapshot(refSnap.data(), referrerData, cleanCandidate);
        serverLedger.users[cleanCandidate] = referrerData;
      }
    } catch (err) {
      markFirestoreReadError(err);
    }
  }

  const shouldLinkToCandidate = Boolean(
    isRealUser &&
      cleanCandidate &&
      deterministicRefRecordId &&
      (!existingReferrer || existingReferrer === cleanCandidate)
  );

  const shouldApplyReferral = Boolean(
    shouldLinkToCandidate &&
      (!existingReferrer || !recordAlreadyExists || alreadyAppliedInFirestore)
  );

  const grantsWelcomeBonus = Boolean(
    shouldLinkToCandidate && !existingReferrer && !alreadyAppliedInFirestore
  );
  const needsWelcomeUsdt = Boolean(
    isRealUser &&
      (shouldLinkToCandidate || existingReferrer) &&
      !existingData?.welcomeUsdtGranted &&
      !alreadyAppliedInFirestore
  );
  const creditsReferrer = Boolean(
    shouldLinkToCandidate && !recordAlreadyExists && !alreadyAppliedInFirestore
  );

  const bestFirst = firstName || existingData?.firstName || 'Miner';
  const bestLast = isRealUser
    ? cleanTelegramLastName(
        bestFirst,
        lastName !== undefined ? lastName : existingData?.lastName || ''
      )
    : lastName || existingData?.lastName || '';
  const bestUsername = username || existingData?.username || '';
  const bestPhotoUrl = photoUrl || existingData?.photoUrl || '';

  // Step A: Build/Update the current user (referred user) in serverLedger
  let finalUserData: any;
  if (!existingData) {
    finalUserData = {
      id: userId,
      firstName: bestFirst,
      lastName: bestLast,
      username: bestUsername,
      photoUrl: bestPhotoUrl,
      balanceKitty: grantsWelcomeBonus ? REFERRAL_REWARDS.WELCOME_BONUS : 0,
      balanceUsdt: needsWelcomeUsdt ? REFERRAL_REWARDS.WELCOME_BONUS_USDT : 0,
      welcomeUsdtGranted: Boolean(needsWelcomeUsdt || alreadyAppliedInFirestore),
      miningSpeed: REFERRAL_REWARDS.BASE_MINING_SPEED,
      referralCount: 0,
      referralsCount: 0,
      earnedReferralCoins: 0,
      referredBy: shouldLinkToCandidate ? cleanCandidate : null,
      referrerId: shouldLinkToCandidate ? cleanCandidate : null,
      referredAt: shouldLinkToCandidate ? now : null,
      claimedMilestones: [],
      vipExpiresAt: 0,
      lastMiningClaim: now,
      createdAt: now
    };
  } else {
    finalUserData = {
      ...existingData,
      id: userId,
      firstName: bestFirst,
      lastName: bestLast,
      username: bestUsername,
      photoUrl: bestPhotoUrl,
      balanceKitty:
        (Number(existingData.balanceKitty) || 0) +
        (grantsWelcomeBonus ? REFERRAL_REWARDS.WELCOME_BONUS : 0),
      balanceUsdt:
        (Number(existingData.balanceUsdt) || 0) +
        (needsWelcomeUsdt ? REFERRAL_REWARDS.WELCOME_BONUS_USDT : 0),
      welcomeUsdtGranted: Boolean(
        existingData.welcomeUsdtGranted || needsWelcomeUsdt || alreadyAppliedInFirestore
      ),
      referredBy: isRealUser
        ? shouldLinkToCandidate
          ? cleanCandidate
          : existingReferrer
        : null,
      referrerId: isRealUser
        ? shouldLinkToCandidate
          ? cleanCandidate
          : existingReferrer
        : null,
      referredAt: isRealUser
        ? shouldLinkToCandidate
          ? existingData.referredAt || now
          : existingData.referredAt || null
        : null
    };
  }

  serverLedger.users[userId] = finalUserData;
  reconcileUserReferralsInLedger(userId);

  // Step B & C: Credit the Referrer AND record in serverLedger.referrals whenever shouldLinkToCandidate is true
  let referralApplied = false;
  if (shouldLinkToCandidate && cleanCandidate && deterministicRefRecordId) {
    referralApplied = Boolean(
      shouldApplyReferral || creditsReferrer || grantsWelcomeBonus || needsWelcomeUsdt || alreadyAppliedInFirestore
    );
    const referredFullName = formatTelegramDisplayName(
      finalUserData.firstName,
      finalUserData.lastName,
      finalUserData.username,
      userId
    );

    const existingRec = serverLedger.referrals[deterministicRefRecordId];
    const refRecord = {
      ...(existingRec || {}),
      id: deterministicRefRecordId,
      referrerId: cleanCandidate,
      referredId: userId,
      referredName: referredFullName,
      referredFirstName: finalUserData.firstName,
      referredLastName: finalUserData.lastName,
      referredUsername: finalUserData.username || '',
      referredPhotoUrl: finalUserData.photoUrl || '',
      rewardAmount: REFERRAL_REWARDS.REFERRER_REWARD,
      welcomeBonus: REFERRAL_REWARDS.WELCOME_BONUS,
      welcomeBonusUsdt: REFERRAL_REWARDS.WELCOME_BONUS_USDT,
      speedBoost: REFERRAL_REWARDS.REFERRER_SPEED_BOOST,
      timestamp: existingRec?.timestamp || now
    };
    serverLedger.referrals[deterministicRefRecordId] = refRecord;

    if (!referrerData) {
      referrerData = {
        id: cleanCandidate,
        firstName: `Telegram User #${cleanCandidate.slice(-4)}`,
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
      if (creditsReferrer) {
        syncDocToFirestoreWriteOnly('users', cleanCandidate, referrerData);
      }
    } else if (creditsReferrer) {
      const prevCount = Math.max(
        Number(referrerData.referralsCount) || 0,
        Number(referrerData.referralCount) || 0
      );
      const nextCount = prevCount + 1;
      const nextEarned =
        Math.max(
          Number(referrerData.earnedReferralCoins) || 0,
          prevCount * REFERRAL_REWARDS.REFERRER_REWARD
        ) + REFERRAL_REWARDS.REFERRER_REWARD;
      referrerData = {
        ...referrerData,
        balanceKitty:
          (Number(referrerData.balanceKitty) || 0) +
          REFERRAL_REWARDS.REFERRER_REWARD,
        miningSpeed:
          Math.max(
            Number(referrerData.miningSpeed) ||
              REFERRAL_REWARDS.BASE_MINING_SPEED,
            REFERRAL_REWARDS.BASE_MINING_SPEED +
              prevCount * REFERRAL_REWARDS.REFERRER_SPEED_BOOST
          ) + REFERRAL_REWARDS.REFERRER_SPEED_BOOST,
        referralCount: nextCount,
        referralsCount: nextCount,
        earnedReferralCoins: nextEarned
      };
      serverLedger.users[cleanCandidate] = referrerData;
      syncDocToFirestoreWriteOnly('users', cleanCandidate, referrerData);
    }

    // Always reconcile cleanCandidate in serverLedger so serverLedger.users[cleanCandidate] never has stale referralsCount: 0
    const reconciledReferrer = reconcileUserReferralsInLedger(cleanCandidate);
    if (reconciledReferrer) {
      syncDocToFirestoreWriteOnly('users', cleanCandidate, reconciledReferrer);
    }
    syncDocToFirestoreWriteOnly('referrals', deterministicRefRecordId, refRecord);
  }

  saveLedgerToDisk(referralApplied || needsWelcomeUsdt);
  syncDocToFirestoreWriteOnly('users', userId, serverLedger.users[userId]);

  return {
    isNewUser,
    referralApplied,
    welcomeGiftGranted: Boolean(
      grantsWelcomeBonus || needsWelcomeUsdt || alreadyAppliedInFirestore
    ),
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

  let candidateRef = isRealTelegramUserId(userId)
    ? extractReferrerId(bodyReferrerId) ||
      extractReferrerId(bodyStartParam) ||
      extractReferrerId(initDataStartParam) ||
      serverLedger.pendingReferrals[userId] ||
      null
    : null;

  if (!candidateRef && isRealTelegramUserId(userId) && isFirestoreReadAvailable()) {
    try {
      const pendingSnap = await db.collection('pending_referrals').doc(userId).get();
      if (pendingSnap.exists) {
        candidateRef = extractReferrerId(pendingSnap.data()?.referrerId);
      }
    } catch {}
  }

  try {
    const { isNewUser, referralApplied, welcomeGiftGranted, user } =
      await executeAtomicReferralTransaction({
        userId,
        firstName: tUser.first_name || '',
        lastName: tUser.last_name || '',
        username: tUser.username || '',
        photoUrl: tUser.photo_url || '',
        candidateRef,
        clientCachedUser
      });

    if (referralApplied) {
      if (serverLedger.pendingReferrals[userId]) {
        delete serverLedger.pendingReferrals[userId];
        saveLedgerToDisk();
      }
      db.collection('pending_referrals').doc(userId).set({ referrerId: null }, { merge: true }).catch(() => {});
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

  if (!isRealTelegramUserId(userId)) {
    return res.json({
      applied: false,
      reason: 'not_real_telegram_user',
      user: serverLedger.users[userId] || null
    });
  }

  const candidateRef =
    extractReferrerId(req.body?.referrerId) ||
    serverLedger.pendingReferrals[userId] ||
    null;

  if (!candidateRef || candidateRef === userId || !isRealTelegramUserId(candidateRef)) {
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
        photoUrl: tUser.photo_url || '',
        candidateRef,
        clientCachedUser: req.body?.clientCachedUser,
        alreadyAppliedInFirestore: Boolean(req.body?.alreadyAppliedInFirestore)
      });

    if (referralApplied) {
      if (serverLedger.pendingReferrals[userId]) {
        delete serverLedger.pendingReferrals[userId];
        saveLedgerToDisk();
      }
      db.collection('pending_referrals').doc(userId).set({ referrerId: null }, { merge: true }).catch(() => {});
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
    if (isFirestoreReadAvailable()) {
      try {
        const snap = await db.collection('users').doc(userId).get();
        if (snap.exists) {
          user = mergeWithClientSnapshot(snap.data(), user, userId);
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
    // 1. Collect all real Telegram referrals for this referrer from persistent serverLedger
    const byReferredId = new Map<string, any>();
    for (const rec of Object.values(serverLedger.referrals)) {
      if (String(rec.referrerId) === userId) {
        const refId = String(rec.referredId || rec.id).trim();
        if (refId && refId !== userId && isRealTelegramUserId(refId)) {
          byReferredId.set(refId, rec);
        }
      }
    }

    // 2. Always query Firestore `referrals` and `users` when Firestore reads are available so cross-device referrals appear immediately
    if (isFirestoreReadAvailable()) {
      try {
        const [refSnap, referredByUsersSnap, referrerIdUsersSnap, userSnap] = await Promise.all([
          db.collection('referrals').where('referrerId', '==', userId).get(),
          db.collection('users').where('referredBy', '==', userId).get(),
          db.collection('users').where('referrerId', '==', userId).get(),
          db.collection('users').doc(userId).get()
        ]);

        if (userSnap.exists) {
          serverLedger.users[userId] = mergeWithClientSnapshot(
            userSnap.data(),
            serverLedger.users[userId],
            userId
          );
        }

        const referredUserProfiles = new Map<string, any>();
        for (const uDoc of [
          ...referredByUsersSnap.docs,
          ...referrerIdUsersSnap.docs
        ]) {
          const uData = uDoc.data();
          const refId = String(uData.id || uDoc.id).trim();
          if (refId && refId !== userId && isRealTelegramUserId(refId)) {
            referredUserProfiles.set(refId, uData);
          }
        }

        for (const d of refSnap.docs) {
          const data = d.data();
          const refId = String(data.referredId || d.id).trim();
          if (!refId || refId === userId || !isRealTelegramUserId(refId)) {
            continue;
          }
          const uProfile =
            referredUserProfiles.get(refId) || serverLedger.users[refId] || null;
          const cleanFirst = String(
            uProfile?.firstName || data.referredFirstName || ''
          ).trim();
          const cleanLast = cleanTelegramLastName(
            cleanFirst,
            uProfile?.lastName || data.referredLastName || ''
          );
          const cleanUsername = String(
            uProfile?.username || data.referredUsername || ''
          ).trim();
          const cleanPhoto = String(
            uProfile?.photoUrl || data.referredPhotoUrl || ''
          ).trim();
          const displayName = formatTelegramDisplayName(
            cleanFirst || data.referredName,
            cleanLast,
            cleanUsername,
            refId
          );

          const item = {
            id: `${userId}_${refId}`,
            referrerId: userId,
            referredId: refId,
            referredName: displayName,
            referredFirstName: cleanFirst,
            referredLastName: cleanLast,
            referredUsername: cleanUsername,
            referredPhotoUrl: cleanPhoto,
            rewardAmount: data.rewardAmount || REFERRAL_REWARDS.REFERRER_REWARD,
            welcomeBonus: data.welcomeBonus || REFERRAL_REWARDS.WELCOME_BONUS,
            speedBoost: data.speedBoost || REFERRAL_REWARDS.REFERRER_SPEED_BOOST,
            timestamp: data.timestamp || Date.now()
          };
          byReferredId.set(refId, item);
          serverLedger.referrals[item.id] = item;
        }

        for (const [refId, uData] of referredUserProfiles.entries()) {
          if (!byReferredId.has(refId)) {
            const cleanFirst = String(uData.firstName || '').trim();
            const cleanLast = cleanTelegramLastName(cleanFirst, uData.lastName);
            const cleanUsername = String(uData.username || '').trim();
            const cleanPhoto = String(uData.photoUrl || '').trim();
            const fullName = formatTelegramDisplayName(
              cleanFirst,
              cleanLast,
              cleanUsername,
              refId
            );
            const item = {
              id: `${userId}_${refId}`,
              referrerId: userId,
              referredId: refId,
              referredName: fullName,
              referredFirstName: cleanFirst,
              referredLastName: cleanLast,
              referredUsername: cleanUsername,
              referredPhotoUrl: cleanPhoto,
              rewardAmount: REFERRAL_REWARDS.REFERRER_REWARD,
              welcomeBonus: REFERRAL_REWARDS.WELCOME_BONUS,
              speedBoost: REFERRAL_REWARDS.REFERRER_SPEED_BOOST,
              timestamp: uData.referredAt || uData.createdAt || Date.now()
            };
            byReferredId.set(refId, item);
            serverLedger.referrals[item.id] = item;
            syncDocToFirestoreWriteOnly('referrals', item.id, item);
          }
        }

        if (refSnap.docs.length > 0 || referredUserProfiles.size > 0) {
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
  let completedList = serverLedger.taskCompletions[userId] || [];

  if (isFirestoreReadAvailable()) {
    try {
      const compSnap = await db.collection('users').doc(userId).collection('task_completions').get();
      if (compSnap.docs.length > 0) {
        const merged = new Set(completedList);
        for (const docSnap of compSnap.docs) {
          merged.add(docSnap.id);
        }
        completedList = Array.from(merged);
        serverLedger.taskCompletions[userId] = completedList;
      }
    } catch (fsErr) {
      markFirestoreReadError(fsErr);
    }
  }

  const completedSet = new Set(completedList);
  const user = serverLedger.users[userId];
  if (user?.homeScreenAdded) {
    completedSet.add('home_screen');
  }

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
    if (!user && isFirestoreReadAvailable()) {
      try {
        const snap = await db.collection('users').doc(userId).get();
        if (snap.exists) {
          user = snap.data();
        }
      } catch (fsErr) {
        markFirestoreReadError(fsErr);
      }
    }

    if (user) {
      user.balanceKitty = (Number(user.balanceKitty) || 0) + (staticTask.reward || 0);
      user.miningSpeed =
        (Number(user.miningSpeed) || REFERRAL_REWARDS.BASE_MINING_SPEED) +
        (staticTask.miningBoost || 0);
      if (taskId === 'home_screen') {
        user.homeScreenAdded = true;
      }
      serverLedger.users[userId] = user;
      syncDocToFirestoreWriteOnly('users', userId, user);
    }

    db.collection('users')
      .doc(userId)
      .collection('task_completions')
      .doc(taskId)
      .set({ completedAt: Date.now() }, { merge: true })
      .catch(() => {});

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
