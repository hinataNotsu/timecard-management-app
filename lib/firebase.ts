import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Firebase設定オブジェクト
const firebaseConfig = {
  apiKey: "AIzaSyD0XOaGeg1RNS_PrfFvE5yLuWVKgf_RjkY",
  authDomain: "timecard-management-app.firebaseapp.com",
  projectId: "timecard-management-app",
  storageBucket: "timecard-management-app.firebasestorage.app",
  messagingSenderId: "168880459496",
  appId: "1:168880459496:web:457db17d5e4465a61a035d"
};

// Firebase の初期化(複数回初期化されないようにチェック)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Firebase サービスのインスタンスをエクスポート
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export default app;
