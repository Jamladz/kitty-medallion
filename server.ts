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

    // Allow mock user if we are in local development, or on preview host, or if no Telegram bot token is configured, or if we are accessing outside Telegram context
    const isPreviewHost = req.hostname && (req.hostname.includes('run.app') || req.hostname.includes('localhost'));
    const isMockAllowed = process.env.NODE_ENV !== 'production' || isPreviewHost || BOT_TOKEN === 'test_token' || !initData || initData === 'undefined';

    if (isMockAllowed && (!initData || initData === 'undefined' || !initData.includes('hash='))) {
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

    if (!initData) {
      return res.status(401).json({ error: 'Unauthorized: Missing Telegram WebApp initData' });
    }

    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    
    if (!hash) {
      return res.status(401).json({ error: 'Unauthorized: Missing signature hash' });
    }

    urlParams.delete('hash');
    const paramsList: string[] = [];
    urlParams.forEach((value, key) => {
      paramsList.push(`${key}=${value}`);
    });
    paramsList.sort();
    const dataCheckString = paramsList.join('\n');
    
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    const bypassSignature = isPreviewHost || BOT_TOKEN === 'test_token';

    if (calculatedHash !== hash && !bypassSignature && process.env.NODE_ENV !== 'development') {
      return res.status(401).json({ error: 'Unauthorized: Invalid Telegram signature' });
    }

    const userStr = urlParams.get('user');
    if (!userStr) {
      return res.status(401).json({ error: 'Unauthorized: Missing user payload' });
    }

    const user = JSON.parse(userStr);
    (req as any).telegramUser = user;
    (req as any).userId = String(user.id);
    next();
  } catch (error: any) {
    console.error('Telegram authentication exception:', error);
    return res.status(401).json({ error: 'Unauthorized: Authentication exception occurred', details: error.message });
  }
};

// Seed tasks if empty
async function seedTasks() {
  const tasksRef = db.collection('tasks');
  const snap = await tasksRef.limit(1).get();
  if (snap.empty) {
    const defaultTasks = [
      { id: 'telegram_channel', title: 'Join our Telegram Channel', description: 'Stay updated with the latest news.', reward: 1000, miningBoost: 50, type: 'social', isActive: true },
      { id: 'twitter_follow', title: 'Follow us on X (Twitter)', description: 'Follow our official X account.', reward: 500, miningBoost: 20, type: 'social', isActive: true },
      { id: 'home_screen', title: 'Add Kitty Medallion to Home Screen', description: 'Add Kitty Medallion to your phone\'s home screen for faster access and receive a Kitty Medallion reward.', reward: 2000, miningBoost: 100, type: 'home_screen', isActive: true },
      { id: 'watch_ad', title: 'Watch an Ad', description: 'Support the project by watching a short ad.', reward: 500, miningBoost: 10, type: 'monetag', isActive: true }
    ];
    for (const task of defaultTasks) {
      await tasksRef.doc(task.id).set(task);
    }
  }
}
seedTasks().catch(console.error);


const extractReferrerId = (rawParam?: string | null): string | null => {
  if (!rawParam) return null;
  const cleaned = String(rawParam).trim();
  if (!cleaned) return null;
  const withoutPrefix = cleaned.replace(/^(ref_|r_|ref-|invite_)/i, '');
  if (/^\d+$/.test(withoutPrefix)) {
    return withoutPrefix;
  }
  return null;
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

// Telegram Bot Webhook receiver so `/start ref_123456` links record pending referral automatically
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
        await db.collection('pending_referrals').doc(newUserId).set({
          userId: newUserId,
          referrerId: inviterId,
          createdAt: Date.now()
        });
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

async function executeAtomicReferralTransaction(params: {
  userId: string;
  firstName: string;
  lastName: string;
  username: string;
  candidateRef: string | null;
}) {
  const { userId, firstName, lastName, username, candidateRef } = params;
  const userRef = db.collection('users').doc(userId);
  let isNewUser = false;
  let referralApplied = false;

  await db.runTransaction(async (t) => {
    const userDoc = await t.get(userRef);

    const validReferrer =
      candidateRef && candidateRef !== userId ? candidateRef : null;

    let referrerDoc: any = null;
    const refUserRef = validReferrer
      ? db.collection('users').doc(validReferrer)
      : null;

    if (refUserRef) {
      referrerDoc = await t.get(refUserRef);
    }

    const now = Date.now();
    const referredFullName =
      `${firstName} ${lastName}`.trim() || username || `Miner #${userId.slice(-4)}`;

    // Check if already referred or circular referral
    const existingData = userDoc.exists ? userDoc.data() : null;
    const alreadyReferred = Boolean(
      existingData?.referredBy || existingData?.referrerId
    );
    const isCircular =
      referrerDoc?.exists &&
      (referrerDoc.data()?.referredBy === userId ||
        referrerDoc.data()?.referrerId === userId);

    const shouldApplyReferral = Boolean(
      validReferrer && refUserRef && !alreadyReferred && !isCircular
    );

    // Step A: Update or Create the referred user document
    if (!userDoc.exists) {
      isNewUser = true;
      t.set(userRef, {
        id: userId,
        firstName: firstName || '',
        lastName: lastName || '',
        username: username || '',
        balanceKitty: shouldApplyReferral ? REFERRAL_REWARDS.WELCOME_BONUS : 0,
        balanceUsdt: 0,
        miningSpeed: REFERRAL_REWARDS.BASE_MINING_SPEED,
        referralCount: 0,
        referralsCount: 0,
        earnedReferralCoins: 0,
        referredBy: shouldApplyReferral ? validReferrer : null,
        referrerId: shouldApplyReferral ? validReferrer : null,
        referredAt: shouldApplyReferral ? now : null,
        claimedMilestones: [],
        vipExpiresAt: 0,
        lastMiningClaim: now,
        createdAt: now
      });
    } else {
      const updates: Record<string, any> = {
        firstName: firstName || existingData.firstName || '',
        lastName: lastName || existingData.lastName || '',
        username: username || existingData.username || ''
      };

      if (shouldApplyReferral) {
        updates.referredBy = validReferrer;
        updates.referrerId = validReferrer;
        updates.referredAt = now;
        updates.balanceKitty = FieldValue.increment(REFERRAL_REWARDS.WELCOME_BONUS);
      }

      t.update(userRef, updates);
    }

    // Step B & C: Update/Create the referrer document AND create record in "referrals" collection
    if (shouldApplyReferral && validReferrer && refUserRef) {
      referralApplied = true;

      if (!referrerDoc || !referrerDoc.exists) {
        // Create referrer document if it didn't exist yet
        t.set(refUserRef, {
          id: validReferrer,
          firstName: `Miner #${validReferrer.slice(-4)}`,
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
        });
      } else {
        t.update(refUserRef, {
          balanceKitty: FieldValue.increment(REFERRAL_REWARDS.REFERRER_REWARD),
          miningSpeed: FieldValue.increment(REFERRAL_REWARDS.REFERRER_SPEED_BOOST),
          referralCount: FieldValue.increment(1),
          referralsCount: FieldValue.increment(1),
          earnedReferralCoins: FieldValue.increment(REFERRAL_REWARDS.REFERRER_REWARD)
        });
      }

      const referralRecordRef = db.collection('referrals').doc();
      t.set(referralRecordRef, {
        id: referralRecordRef.id,
        referrerId: validReferrer,
        referredId: userId,
        referredName: referredFullName,
        referredUsername: username || '',
        rewardAmount: REFERRAL_REWARDS.REFERRER_REWARD,
        welcomeBonus: REFERRAL_REWARDS.WELCOME_BONUS,
        speedBoost: REFERRAL_REWARDS.REFERRER_SPEED_BOOST,
        timestamp: now
      });
    }
  });

  return { isNewUser, referralApplied };
}

app.post('/api/auth', authenticateTelegram, async (req, res) => {
  const tUser = (req as any).telegramUser;
  const userId = String((req as any).userId);
  const { referrerId: bodyReferrerId, startParam: bodyStartParam } = req.body;

  const authHeader = req.headers.authorization;
  const rawInitData =
    (authHeader && authHeader.startsWith('Bearer tma ')
      ? authHeader.split('Bearer tma ')[1]
      : '') ||
    String(req.headers['x-telegram-init-data'] || '');
  const initDataStartParam = rawInitData
    ? new URLSearchParams(rawInitData).get('start_param')
    : null;

  let candidateRef =
    extractReferrerId(bodyReferrerId) ||
    extractReferrerId(bodyStartParam) ||
    extractReferrerId(initDataStartParam);

  try {
    if (!candidateRef) {
      const pendingDoc = await db.collection('pending_referrals').doc(userId).get();
      if (pendingDoc.exists) {
        candidateRef = extractReferrerId(pendingDoc.data()?.referrerId);
      }
    }

    const { isNewUser, referralApplied } = await executeAtomicReferralTransaction({
      userId,
      firstName: tUser.first_name || '',
      lastName: tUser.last_name || '',
      username: tUser.username || '',
      candidateRef
    });

    const updatedDoc = await db.collection('users').doc(userId).get();
    res.json({
      token: 'mock_token',
      userId,
      user: updatedDoc.data(),
      isNewUser,
      referralApplied
    });
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/referrals/process', authenticateTelegram, async (req, res) => {
  const tUser = (req as any).telegramUser;
  const userId = String((req as any).userId);
  const candidateRef = extractReferrerId(req.body?.referrerId);

  if (!candidateRef || candidateRef === userId) {
    return res.json({ applied: false, reason: 'invalid_or_self_referral' });
  }

  try {
    const { referralApplied } = await executeAtomicReferralTransaction({
      userId,
      firstName: tUser.first_name || '',
      lastName: tUser.last_name || '',
      username: tUser.username || '',
      candidateRef
    });
    res.json({ applied: referralApplied });
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
    await db.runTransaction(async (t) => {
      const userRef = db.collection('users').doc(userId);
      const userDoc = await t.get(userRef);
      if (!userDoc.exists) throw new Error('User not found');

      const data = userDoc.data()!;
      const count = Math.max(data.referralsCount || 0, data.referralCount || 0);
      const claimed: string[] = Array.isArray(data.claimedMilestones)
        ? data.claimedMilestones
        : [];

      if (claimed.includes(milestone.id)) {
        throw new Error('Milestone already claimed');
      }
      if (count < milestone.targetCount) {
        throw new Error(`Requires ${milestone.targetCount} referrals`);
      }

      const now = Date.now();
      const baseExpiry =
        data.vipExpiresAt && data.vipExpiresAt > now ? data.vipExpiresAt : now;
      const newVipExpiry = baseExpiry + milestone.vipDays * 24 * 60 * 60 * 1000;

      t.update(userRef, {
        balanceKitty: FieldValue.increment(milestone.rewardCoins),
        earnedReferralCoins: FieldValue.increment(milestone.rewardCoins),
        miningSpeed: FieldValue.increment(milestone.speedBoost),
        claimedMilestones: FieldValue.arrayUnion(milestone.id),
        vipExpiresAt: newVipExpiry
      });
    });

    res.json({
      success: true,
      milestoneId: milestone.id,
      rewardCoins: milestone.rewardCoins,
      vipDays: milestone.vipDays
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Could not claim milestone' });
  }
});

app.get('/api/referrals', authenticateTelegram, async (req, res) => {
  const userId = String((req as any).userId);
  try {
    // 1. Query dedicated "referrals" collection where('referrerId', '==', userId)
    const refSnap = await db
      .collection('referrals')
      .where('referrerId', '==', userId)
      .get();

    let referrals = refSnap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        referrerId: data.referrerId,
        referredId: data.referredId,
        referredName: data.referredName || 'Telegram Friend',
        referredUsername: data.referredUsername || '',
        rewardAmount: data.rewardAmount || REFERRAL_REWARDS.REFERRER_REWARD,
        welcomeBonus: data.welcomeBonus || REFERRAL_REWARDS.WELCOME_BONUS,
        speedBoost: data.speedBoost || REFERRAL_REWARDS.REFERRER_SPEED_BOOST,
        timestamp: data.timestamp || Date.now()
      };
    });

    // 2. Backwards-compatible fallback: also include any users with referrerId == userId not yet in "referrals"
    const usersSnap = await db
      .collection('users')
      .where('referrerId', '==', userId)
      .get();

    const recordedIds = new Set(referrals.map((r) => String(r.referredId)));
    for (const uDoc of usersSnap.docs) {
      if (!recordedIds.has(String(uDoc.id))) {
        const uData = uDoc.data();
        referrals.push({
          id: `legacy_${uDoc.id}`,
          referrerId: userId,
          referredId: uDoc.id,
          referredName:
            `${uData.firstName || ''} ${uData.lastName || ''}`.trim() ||
            uData.username ||
            'Telegram Friend',
          referredUsername: uData.username || '',
          rewardAmount: REFERRAL_REWARDS.REFERRER_REWARD,
          welcomeBonus: REFERRAL_REWARDS.WELCOME_BONUS,
          speedBoost: REFERRAL_REWARDS.REFERRER_SPEED_BOOST,
          timestamp: uData.referredAt || uData.createdAt || Date.now()
        });
      }
    }

    referrals.sort((a, b) => b.timestamp - a.timestamp);

    res.json({ referrals, count: referrals.length });
  } catch (error) {
    console.error('Get referrals error:', error);
    res.status(500).json({ error: 'Failed to load referrals' });
  }
});

app.get('/api/referrals/leaderboard', authenticateTelegram, async (req, res) => {
  const userId = String((req as any).userId);
  const maxLimit = Math.min(50, Math.max(5, Number(req.query.limit) || 15));

  try {
    const snap = await db
      .collection('users')
      .orderBy('referralsCount', 'desc')
      .limit(maxLimit)
      .get();

    const leaderboard = snap.docs.map((d, idx) => {
      const data = d.data();
      const count = Math.max(data.referralsCount || 0, data.referralCount || 0);
      return {
        id: d.id,
        firstName: data.firstName || 'Miner',
        lastName: data.lastName || '',
        username: data.username || '',
        referralsCount: count,
        earnedReferralCoins:
          data.earnedReferralCoins || count * REFERRAL_REWARDS.REFERRER_REWARD,
        isCurrentUser: String(d.id) === userId,
        rank: idx + 1
      };
    });

    res.json({ leaderboard });
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

const MINING_CYCLE_MS = 24 * 60 * 60 * 1000;

async function claimMining(userId: string) {
  const userRef = db.collection('users').doc(userId);
  return await db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists) throw new Error('User not found');
    const data = userDoc.data()!;
    const now = Date.now();
    const lastClaim = data.lastMiningClaim || now;
    const timePassedMs = now - lastClaim;
    
    if (timePassedMs < MINING_CYCLE_MS) {
      const remainingHours = Math.ceil((MINING_CYCLE_MS - timePassedMs) / (1000 * 60 * 60));
      throw new Error(`Mining cycle in progress. Ready in ~${remainingHours}h.`);
    }

    const earned = data.miningSpeed || 500;
    transaction.update(userRef, {
      balanceKitty: FieldValue.increment(earned),
      lastMiningClaim: now
    });
    return earned;
  });
}

app.post('/api/claim-mining', authenticateTelegram, async (req, res) => {
  const userId = (req as any).userId;
  try {
    const earned = await claimMining(userId);
    const userDoc = await db.collection('users').doc(userId).get();
    res.json({ success: true, earned, user: userDoc.data() });
  } catch (error: any) {
    console.error('Claim mining error:', error);
    res.status(400).json({ error: error.message || 'Mining cycle not finished yet' });
  }
});

app.get('/api/tasks', authenticateTelegram, async (req, res) => {
  const userId = (req as any).userId;
  try {
    const tasksSnapshot = await db.collection('tasks').where('isActive', '==', true).get();
    const completionsSnapshot = await db.collection('users').doc(userId).collection('task_completions').get();
    const completedTaskIds = new Set(completionsSnapshot.docs.map(d => d.id));
    
    const tasks = tasksSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        ...data,
        isCompleted: completedTaskIds.has(doc.id)
      };
    });
    res.json({ tasks });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/tasks/claim', authenticateTelegram, async (req, res) => {
  const userId = (req as any).userId;
  const { taskId } = req.body;
  if (!taskId) return res.status(400).json({ error: 'taskId required' });
  
  try {
    const result = await db.runTransaction(async (t) => {
      const taskRef = db.collection('tasks').doc(taskId);
      const completionRef = db.collection('users').doc(userId).collection('task_completions').doc(taskId);
      const userRef = db.collection('users').doc(userId);
      
      const [taskDoc, compDoc, userDoc] = await Promise.all([t.get(taskRef), t.get(completionRef), t.get(userRef)]);
      
      if (!taskDoc.exists || !taskDoc.data()?.isActive) throw new Error('Task not found or inactive');
      if (compDoc.exists) throw new Error('Task already completed');
      if (!userDoc.exists) throw new Error('User not found');
      
      const task = taskDoc.data()!;
      t.set(completionRef, { completedAt: Date.now() });
      t.update(userRef, {
        balanceKitty: FieldValue.increment(task.reward || 0),
        miningSpeed: FieldValue.increment(task.miningBoost || 0)
      });
      return task;
    });
    res.json({ success: true, reward: result.reward, miningBoost: result.miningBoost });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/swap', authenticateTelegram, async (req, res) => {
  const userId = (req as any).userId;
  const { amountUsdt } = req.body;
  if (!amountUsdt || amountUsdt <= 0) return res.status(400).json({ error: 'Invalid amount' });
  
  const costKitty = amountUsdt * 10000;
  
  try {
    await db.runTransaction(async (t) => {
      const userRef = db.collection('users').doc(userId);
      const userDoc = await t.get(userRef);
      if (!userDoc.exists) throw new Error('User not found');
      
      const balance = userDoc.data()!.balanceKitty || 0;
      if (balance < costKitty) throw new Error('Insufficient Kitty Medallion balance');
      
      const swapRef = db.collection('swaps').doc();
      t.set(swapRef, {
        userId, amountKitty: costKitty, amountUsdt, timestamp: Date.now()
      });
      t.update(userRef, {
        balanceKitty: FieldValue.increment(-costKitty),
        balanceUsdt: FieldValue.increment(amountUsdt)
      });
    });
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/withdraw', authenticateTelegram, async (req, res) => {
  const userId = (req as any).userId;
  const { amount, address } = req.body;
  if (!amount || amount <= 0 || !address) return res.status(400).json({ error: 'Invalid request' });
  
  try {
    await db.runTransaction(async (t) => {
      const userRef = db.collection('users').doc(userId);
      const userDoc = await t.get(userRef);
      const balance = userDoc.data()!.balanceUsdt || 0;
      if (balance < amount) throw new Error('Insufficient USDT balance');
      
      const wRef = db.collection('withdrawals').doc();
      t.set(wRef, {
        userId, amount, address, status: 'Pending', timestamp: Date.now()
      });
      t.update(userRef, {
        balanceUsdt: FieldValue.increment(-amount)
      });
    });
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/withdrawals', authenticateTelegram, async (req, res) => {
  const userId = (req as any).userId;
  try {
    const snap = await db.collection('withdrawals').where('userId', '==', userId).orderBy('timestamp', 'desc').get();
    res.json({ withdrawals: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/early-user/claim', authenticateTelegram, async (req, res) => {
  const userId = (req as any).userId;
  try {
    const result = await db.runTransaction(async (t) => {
      const stateRef = db.collection('system').doc('state');
      const stateDoc = await t.get(stateRef);
      const count = stateDoc.exists ? stateDoc.data()!.earlyUsersCount || 0 : 0;
      
      if (count >= 100) throw new Error('Early user limit reached');
      
      const earlyRef = db.collection('early_users').doc(userId);
      const earlyDoc = await t.get(earlyRef);
      if (earlyDoc.exists) throw new Error('Already claimed');
      
      t.set(earlyRef, { claimedAt: Date.now() });
      t.set(stateRef, { earlyUsersCount: count + 1 }, { merge: true });
      
      const userRef = db.collection('users').doc(userId);
      t.update(userRef, {
        balanceKitty: FieldValue.increment(5000)
      });
      return count + 1;
    });
    res.json({ success: true, count: result });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/early-user/status', authenticateTelegram, async (req, res) => {
  const userId = (req as any).userId;
  try {
    const stateDoc = await db.collection('system').doc('state').get();
    const count = stateDoc.exists ? stateDoc.data()!.earlyUsersCount || 0 : 0;
    
    const earlyDoc = await db.collection('early_users').doc(userId).get();
    const isClaimed = earlyDoc.exists;
    
    res.json({ count, isClaimed });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
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
