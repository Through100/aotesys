import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey:
    import.meta.env.VITE_FIREBASE_API_KEY ||
    "AIzaSyDFuwmHWwbcdfMQ-r35ZoewHI8W1L-9-E4",
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ||
    "aotesys-9c7a5.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "aotesys-9c7a5",
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ||
    "aotesys-9c7a5.firebasestorage.app",
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "98241305437",
  appId:
    import.meta.env.VITE_FIREBASE_APP_ID ||
    "1:98241305437:web:254070f89c95914763a6b4",
  measurementId:
    import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-GDXL763NJ6"
};

export const firebaseApp = initializeApp(firebaseConfig);

export async function initializeFirebaseAnalytics() {
  if (typeof window === "undefined" || !firebaseConfig.measurementId) {
    return null;
  }

  if (!(await isSupported())) {
    return null;
  }

  return getAnalytics(firebaseApp);
}
