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

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'test_token';

const authenticateTelegram = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  const initData = authHeader && authHeader.startsWith('Bearer tma ') ? authHeader.split('Bearer tma ')[1] : '';

  // Allow mock user if we are in local development, or if no Telegram bot token is configured, or if we are accessing outside Telegram context (like dev/preview)
  const isMockAllowed = process.env.NODE_ENV !== 'production' || BOT_TOKEN === 'test_token' || !initData || initData === 'undefined';

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

  if (!authHeader || !authHeader.startsWith('Bearer tma ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid token format' });
  }

  const urlParams = new URLSearchParams(initData);
  const hash = urlParams.get('hash');
  
  if (!hash) {
    return res.status(401).json({ error: 'Unauthorized: Missing hash' });
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

  if (calculatedHash !== hash && process.env.NODE_ENV !== 'development' && BOT_TOKEN !== 'test_token') {
    return res.status(401).json({ error: 'Unauthorized: Invalid signature' });
  }

  const userStr = urlParams.get('user');
  if (!userStr) {
    return res.status(401).json({ error: 'Unauthorized: Missing user data' });
  }

  try {
    const user = JSON.parse(userStr);
    (req as any).telegramUser = user;
    (req as any).userId = String(user.id);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Unauthorized: Invalid user JSON' });
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


app.post('/api/auth', authenticateTelegram, async (req, res) => {
  const tUser = (req as any).telegramUser;
  const userId = (req as any).userId;
  const { referrerId } = req.body;
  
  try {
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    let isNewUser = false;
    
    if (!userDoc.exists) {
      isNewUser = true;
      let validReferrer = null;
      if (referrerId && referrerId !== userId) {
        const refDoc = await db.collection('users').doc(referrerId).get();
        if (refDoc.exists) validReferrer = referrerId;
      }
      
      const batch = db.batch();
      batch.set(userRef, {
        id: userId,
        firstName: tUser.first_name || '',
        lastName: tUser.last_name || '',
        username: tUser.username || '',
        balanceKitty: validReferrer ? 100 : 0,
        balanceUsdt: 0,
        miningSpeed: 500, // base mining 500/day
        referralCount: 0,
        referrerId: validReferrer,
        lastMiningClaim: Date.now(),
        createdAt: Date.now()
      });
      
      if (validReferrer) {
        const refUserRef = db.collection('users').doc(validReferrer);
        batch.update(refUserRef, {
          balanceKitty: FieldValue.increment(100),
          miningSpeed: FieldValue.increment(50),
          referralCount: FieldValue.increment(1)
        });
      }
      await batch.commit();
    } else {
      // Auto-claim mining rewards on login just to keep balance fresh
      await claimMining(userId);
    }
    
    const updatedDoc = await userRef.get();
    res.json({ token: 'mock_token', userId, user: updatedDoc.data(), isNewUser });
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function claimMining(userId: string) {
  const userRef = db.collection('users').doc(userId);
  await db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists) return;
    const data = userDoc.data()!;
    const now = Date.now();
    const timePassedMs = now - data.lastMiningClaim;
    const daysPassed = timePassedMs / (1000 * 60 * 60 * 24);
    
    if (daysPassed > 0.001) { // minimum threshold to claim
      const earned = daysPassed * data.miningSpeed;
      transaction.update(userRef, {
        balanceKitty: FieldValue.increment(earned),
        lastMiningClaim: now
      });
    }
  });
}

app.post('/api/claim-mining', authenticateTelegram, async (req, res) => {
  const userId = (req as any).userId;
  try {
    await claimMining(userId);
    const userDoc = await db.collection('users').doc(userId).get();
    res.json({ user: userDoc.data() });
  } catch (error) {
    console.error('Claim mining error:', error);
    res.status(500).json({ error: 'Internal server error' });
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
