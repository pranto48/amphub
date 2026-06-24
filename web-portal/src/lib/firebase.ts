import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfigEnv = process.env.NEXT_PUBLIC_FIREBASE_CONFIG;

let app: any;
let db: any;

const mockDb = {
  // A mock firestore database object to prevent runtime crashes when Firebase isn't configured
  type: "mock",
};

if (firebaseConfigEnv) {
  try {
    const config = JSON.parse(firebaseConfigEnv);
    app = getApps().length === 0 ? initializeApp(config) : getApp();
    db = getFirestore(app);
  } catch (error) {
    console.error("Failed to parse NEXT_PUBLIC_FIREBASE_CONFIG env variable:", error);
    db = mockDb;
  }
} else {
  if (process.env.NODE_ENV !== "production") {
    console.warn("NEXT_PUBLIC_FIREBASE_CONFIG is not set. Firebase integration will run in offline demo mode.");
  }
  db = mockDb;
}

export { db };
export default app;
