import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';

export async function POST(req: NextRequest) {
  try {
    const { email, password, displayName, organizationId, createdByUid } = await req.json();

    // 入力検証
    if (!email || !password || !organizationId || !createdByUid) {
      return NextResponse.json({ error: '必須項目が不足しています' }, { status: 400 });
    }

    // パスワード長チェック
    if (password.length < 6) {
      return NextResponse.json({ error: 'パスワードは6文字以上である必要があります' }, { status: 400 });
    }

    // Firebase Admin SDK を動的にインポート
    let adminAuth, adminDb;
    try {
      const adminModule = await import('@/lib/firebase-admin');
      adminAuth = adminModule.adminAuth;
      adminDb = adminModule.adminDb;
    } catch (error: any) {
      console.error('[API] Firebase Admin initialization error:', error);
      return NextResponse.json({ 
        error: 'Firebase Admin SDKの初期化に失敗しました。サーバー設定を確認してください。',
        details: error.message 
      }, { status: 500 });
    }

    // 作成者が管理者かチェック
    const creatorDoc = await adminDb.collection('users').doc(createdByUid).get();
    if (!creatorDoc.exists) {
      return NextResponse.json({ error: '作成者が見つかりません' }, { status: 403 });
    }
    const creatorData = creatorDoc.data();
    if (!creatorData?.isManage) {
      return NextResponse.json({ error: '管理者権限がありません' }, { status: 403 });
    }
    if (!creatorData?.organizationIds?.includes(organizationId)) {
      return NextResponse.json({ error: '指定された組織への権限がありません' }, { status: 403 });
    }

    // Firebase Authentication でユーザー作成
    const baseName: string = (displayName && typeof displayName === 'string' && displayName.trim()) || email.split('@')[0];
    const safeDisplayName = baseName.substring(0, 20);

    const userRecord = await adminAuth.createUser({
      email,
      password,
      displayName: safeDisplayName,
      emailVerified: false,
    });

    // Firestore に users ドキュメント作成
    await adminDb.collection('users').doc(userRecord.uid).set({
      uid: userRecord.uid,
      email,
      displayName: safeDisplayName,
      isManage: false,
      organizationIds: [organizationId],
      currentOrganizationId: organizationId,
      avatarSeed: safeDisplayName,
      requirePasswordChange: true, // 初回ログイン時にパスワード変更を促す
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // organizations/{orgId}/members/{uid} にメンバー設定を作成
    await adminDb.collection('organizations').doc(organizationId).collection('members').doc(userRecord.uid).set({
      transportAllowancePerShift: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      uid: userRecord.uid,
      email: userRecord.email,
    });
  } catch (error: any) {
    console.error('[API] create-user error:', error);
    
    if (error.code === 'auth/email-already-exists') {
      return NextResponse.json({ error: 'このメールアドレスは既に使用されています' }, { status: 400 });
    }
    
    return NextResponse.json({ 
      error: 'ユーザーの作成に失敗しました',
      details: error.message || error.toString()
    }, { status: 500 });
  }
}
