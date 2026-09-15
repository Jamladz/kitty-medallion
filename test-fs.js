import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
const app = initializeApp({
  credential: applicationDefault(),
  projectId: config.projectId
});
const db = getFirestore(config.firestoreDatabaseId);

async function run() {
  try {
    const snap = await db.collection('tasks').limit(1).get();
    console.log("Success! Docs:", snap.size);
  } catch (e) {
    console.error("Error:", e.message);
  }
}
run();
