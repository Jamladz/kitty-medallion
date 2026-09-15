import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  increment, 
  writeBatch, 
  runTransaction, 
  query, 
  where, 
  limit as firestoreLimit, 
  orderBy 
} from 'firebase/firestore';
import fs from 'fs';
import path from 'path';

const firebaseConfigPath = path.join(process.cwd(), 'firebase-applet-config.json');
if (!fs.existsSync(firebaseConfigPath)) {
  throw new Error('firebase-applet-config.json not found!');
}

const config = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8'));
const databaseId = config.firestoreDatabaseId || '(default)';

const clientApp = initializeApp(config);
export const clientDb = getFirestore(clientApp, databaseId);

export const FieldValue = {
  increment: (val: number) => increment(val)
};

export class CollectionWrapper {
  public path: string;
  private queryConstraints: any[] = [];

  constructor(path: string, queryConstraints: any[] = []) {
    this.path = path;
    this.queryConstraints = queryConstraints;
  }

  doc(docId?: string) {
    const finalId = docId || doc(collection(clientDb, this.path)).id;
    return {
      id: finalId,
      collectionPath: this.path,
      get: async () => {
        const docRef = doc(clientDb, this.path, finalId);
        const snap = await getDoc(docRef);
        return {
          exists: snap.exists(),
          data: () => snap.data()
        };
      },
      set: async (data: any) => {
        const docRef = doc(clientDb, this.path, finalId);
        await setDoc(docRef, data);
      },
      update: async (data: any) => {
        const docRef = doc(clientDb, this.path, finalId);
        await updateDoc(docRef, data);
      },
      collection: (subPath: string) => {
        return new CollectionWrapper(`${this.path}/${finalId}/${subPath}`);
      }
    };
  }

  where(field: string, op: any, value: any) {
    return new CollectionWrapper(this.path, [...this.queryConstraints, where(field, op, value)]);
  }

  limit(n: number) {
    return new CollectionWrapper(this.path, [...this.queryConstraints, firestoreLimit(n)]);
  }

  orderBy(field: string, dir: 'asc' | 'desc' = 'asc') {
    return new CollectionWrapper(this.path, [...this.queryConstraints, orderBy(field, dir)]);
  }

  async get() {
    const q = query(collection(clientDb, this.path), ...this.queryConstraints);
    const snap = await getDocs(q);
    return {
      empty: snap.empty,
      docs: snap.docs.map(d => ({
        id: d.id,
        exists: d.exists(),
        data: () => d.data()
      }))
    };
  }
}

export const db = {
  collection: (path: string) => new CollectionWrapper(path),
  batch: () => {
    const batch = writeBatch(clientDb);
    return {
      set: (docWrapper: any, data: any) => {
        const docRef = doc(clientDb, docWrapper.collectionPath, docWrapper.id);
        batch.set(docRef, data);
      },
      update: (docWrapper: any, data: any) => {
        const docRef = doc(clientDb, docWrapper.collectionPath, docWrapper.id);
        batch.update(docRef, data);
      },
      commit: async () => {
        await batch.commit();
      }
    };
  },
  runTransaction: async (fn: (transaction: any) => Promise<any>) => {
    return await runTransaction(clientDb, async (t) => {
      const transactionWrapper = {
        get: async (docWrapper: any) => {
          const docRef = doc(clientDb, docWrapper.collectionPath, docWrapper.id);
          const snap = await t.get(docRef);
          return {
            exists: snap.exists(),
            data: () => snap.data()
          };
        },
        set: (docWrapper: any, data: any) => {
          const docRef = doc(clientDb, docWrapper.collectionPath, docWrapper.id);
          t.set(docRef, data);
        },
        update: (docWrapper: any, data: any) => {
          const docRef = doc(clientDb, docWrapper.collectionPath, docWrapper.id);
          t.update(docRef, data);
        }
      };
      return await fn(transactionWrapper);
    });
  }
};
