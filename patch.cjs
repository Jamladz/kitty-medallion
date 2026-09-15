const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

const target = `if (!getApps().length) {
  initializeApp({ credential: applicationDefault(), projectId });
}`;

const replacement = `if (!getApps().length) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
      initializeApp({
        credential: cert(serviceAccount),
        projectId
      });
    } catch (e) {
      console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY', e);
      initializeApp({ credential: applicationDefault(), projectId });
    }
  } else {
    initializeApp({ credential: applicationDefault(), projectId });
  }
}`;

content = content.replace(target, replacement);
fs.writeFileSync('server.ts', content);
