import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  try {
    // 環境変数から認証情報を取得
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!projectId) {
      throw new Error('NEXT_PUBLIC_FIREBASE_PROJECT_ID is not set');
    }

    if (clientEmail && privateKey) {
      // 本番環境：サービスアカウント認証
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
      console.log('[Firebase Admin] Initialized with service account');
    } else {
      // 開発環境：アプリケーションデフォルト認証情報を使用
      // Firebase Emulator または gcloud auth application-default login が必要
      console.warn('[Firebase Admin] Missing service account credentials. Using default credentials.');
      admin.initializeApp({
        projectId,
      });
    }
  } catch (error) {
    console.error('[Firebase Admin] Initialization error:', error);
    throw error;
  }
}

export const adminAuth = admin.auth();
export const adminDb = admin.firestore();
