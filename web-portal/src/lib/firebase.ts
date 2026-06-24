import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAnalytics, isSupported } from "firebase/analytics";

// Default config provided by user
const defaultFirebaseConfig = {
  apiKey: "AIzaSyBQjDcdbtPakMUT4-mgddt-wqaMk5EpsPg",
  authDomain: "amphub-remote.firebaseapp.com",
  projectId: "amphub-remote",
  storageBucket: "amphub-remote.firebasestorage.app",
  messagingSenderId: "863246842208",
  appId: "1:863246842208:web:6e2de30a5d2f64dde4c605",
  measurementId: "G-KPH40DD1ZX"
};

const firebaseConfigEnv = process.env.NEXT_PUBLIC_FIREBASE_CONFIG;

let firebaseConfig = defaultFirebaseConfig;

if (firebaseConfigEnv) {
  try {
    firebaseConfig = JSON.parse(firebaseConfigEnv);
  } catch (error) {
    console.error("Failed to parse NEXT_PUBLIC_FIREBASE_CONFIG env variable, using default config:", error);
  }
}

let app: any;
let db: any;
let analytics: any = null;

try {
  app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  db = getFirestore(app);
  
  // Initialize analytics only in client-side browser environment
  if (typeof window !== "undefined") {
    isSupported().then((supported) => {
      if (supported) {
        analytics = getAnalytics(app);
      }
    });
  }
} catch (error) {
  console.error("Failed to initialize Firebase:", error);
  // Simple mock db object in case initialization fails
  db = { type: "mock" };
}

export { db, analytics };
export default app;
