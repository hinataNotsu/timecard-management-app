'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { 
  User as FirebaseUser,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged
} from 'firebase/auth';
import { doc, getDoc, setDoc, Timestamp, collection, addDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { useToast } from '@/components/Toast';
import { User } from '@/types';

interface AuthContextType {
  user: FirebaseUser | null;
  userProfile: User | null;
  loading: boolean;
  signUp: (email: string, password: string, isManage: boolean) => Promise<void>;
  signIn: (email: string, password: string) => Promise<any>;
  signOut: () => Promise<void>;
  updateUserProfile: (updates: Partial<User>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { showErrorToast } = useToast();
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      console.log('[AuthContext] Auth state changed:', firebaseUser?.uid);
      setUser(firebaseUser);
      
      if (firebaseUser) {
        // Firestoreからユーザープロフィールを取得
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (userDoc.exists()) {
          const profile = userDoc.data() as User;
          
          // 削除済みユーザーの場合はログアウト
          if (profile.deleted) {
            console.warn('[AuthContext] User account is deleted');
            await firebaseSignOut(auth);
            showErrorToast('このアカウントは削除されています');
            setUserProfile(null);
            setLoading(false);
            return;
          }
          
          console.log('[AuthContext] User profile loaded:', profile);
          setUserProfile(profile);
        } else {
          console.error('[AuthContext] User profile not found in Firestore for uid:', firebaseUser.uid);
          // Firestoreにドキュメントがない場合はログアウト
          await firebaseSignOut(auth);
          showErrorToast('ユーザー情報が見つかりません。管理者に連絡してください。');
          setUserProfile(null);
        }
      } else {
        console.log('[AuthContext] User logged out');
        setUserProfile(null);
      }
      
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const signUp = async (email: string, password: string, isManage: boolean) => {
    console.log('[AuthContext] signUp called', { email, isManage });
    try {
      console.log('[AuthContext] Step 1: Creating Firebase Auth user...');
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      console.log('[AuthContext] Step 1: ✓ Auth user created:', userCredential.user.uid);

      console.log('[AuthContext] Step 1.5: Waiting for auth token to refresh...');
      await userCredential.user.getIdToken(true);
      console.log('[AuthContext] Step 1.5: ✓ Auth token refreshed');

      // 2. Firestoreにユーザードキュメント作成
      const uid = userCredential.user.uid;
      const userData = {
        uid,
        email,
        organizationIds: [],
        isManage,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };
      console.log('[AuthContext] Step 2: setDoc (user) called:', userData);
      await setDoc(doc(db, 'users', uid), userData);
      console.log('[AuthContext] Step 2: ✓ Firestore user document created:', uid);

      // 3. Firestoreにorganizationsコレクション作成（仮名: "新規組織"）
      const orgData = {
        name: '新規組織',
        ownerUid: uid,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      };
      console.log('[AuthContext] Step 3: addDoc (organization) called:', orgData);
      const orgRef = await addDoc(collection(db, 'organizations'), orgData);
      console.log('[AuthContext] Step 3: ✓ Firestore organization document created:', orgRef.id);

      // 4. userData.organizationIdsにorgRef.idを追加して再度setDoc
      const updatedUserData = {
        ...userData,
        organizationIds: [orgRef.id],
        updatedAt: Timestamp.now(),
      };
      console.log('[AuthContext] Step 4: setDoc (user orgIds) called:', updatedUserData);
      await setDoc(doc(db, 'users', uid), updatedUserData);
      console.log('[AuthContext] Step 4: ✓ User organizationIds updated:', orgRef.id);

      setUserProfile(updatedUserData);
      console.log('[AuthContext] ✓ signUp completed successfully');
    } catch (error: any) {
      console.error('[AuthContext] ✗ signUp failed:', error);
      console.error('[AuthContext] Error code:', error?.code);
      console.error('[AuthContext] Error message:', error?.message);
      throw error;
    }
  };

  const signIn = async (email: string, password: string) => {
    return await signInWithEmailAndPassword(auth, email, password);
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    setUserProfile(null);
  };

  const updateUserProfile = async (updates: Partial<User>) => {
    if (!user) throw new Error('ユーザーがログインしていません');
    
    console.log('[AuthContext] updateUserProfile called');
    console.log('[AuthContext] User UID:', user.uid);
    console.log('[AuthContext] Updates:', updates);
    
    const updatedData = {
      ...updates,
      updatedAt: Timestamp.now(),
    };
    
    console.log('[AuthContext] Writing to users/' + user.uid);
    try {
      await setDoc(doc(db, 'users', user.uid), updatedData, { merge: true });
      console.log('[AuthContext] ✓ setDoc completed successfully');
    } catch (err) {
      console.error('[AuthContext] ✗ setDoc failed:', err);
      throw err;
    }
    
    // ローカル状態を更新
    if (userProfile) {
      setUserProfile({ ...userProfile, ...updatedData } as User);
      console.log('[AuthContext] ✓ Local state updated');
    }
  };

  return (
    <AuthContext.Provider value={{ user, userProfile, loading, signUp, signIn, signOut, updateUserProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
