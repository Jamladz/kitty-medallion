import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import fs from 'fs';

const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
const app = initializeApp({
  credential: applicationDefault(),
  projectId: config.projectId
});

async function run() {
  try {
    const token = await getAuth().createCustomToken('test-uid-123');
    console.log("Success! Token:", token.substring(0, 20) + "...");
  } catch (e) {
    console.error("Error:", e.message);
  }
}
run();
