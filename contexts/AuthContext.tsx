'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { 
  User as FirebaseUser,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged
} from 'firebase/auth';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
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
            alert('このアカウントは削除されています');
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
          alert('ユーザー情報が見つかりません。管理者に連絡してください。');
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
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    
    // Firestoreにユーザー情報を保存
    const userData: User = {
      uid: userCredential.user.uid,
      email: email,
      organizationIds: [],
      isManage: isManage,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };
    
    await setDoc(doc(db, 'users', userCredential.user.uid), userData);
    setUserProfile(userData);
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
    
    const updatedData = {
      ...updates,
      updatedAt: Timestamp.now(),
    };
    
    await setDoc(doc(db, 'users', user.uid), updatedData, { merge: true });
    
    // ローカル状態を更新
    if (userProfile) {
      setUserProfile({ ...userProfile, ...updatedData } as User);
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
