import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';

export async function POST(req: NextRequest) {
  try {
    const { targetUid, adminUid, organizationId } = await req.json();

    // 入力検証
    if (!targetUid || !adminUid || !organizationId) {
      return NextResponse.json({ error: '必須項目が不足しています' }, { status: 400 });
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

    // 管理者権限チェック
    const adminDoc = await adminDb.collection('users').doc(adminUid).get();
    if (!adminDoc.exists) {
      return NextResponse.json({ error: '管理者が見つかりません' }, { status: 403 });
    }
    const adminData = adminDoc.data();
    if (!adminData?.isManage) {
      return NextResponse.json({ error: '管理者権限がありません' }, { status: 403 });
    }
    if (!adminData?.organizationIds?.includes(organizationId)) {
      return NextResponse.json({ error: '指定された組織への権限がありません' }, { status: 403 });
    }

    // 対象ユーザーの情報を取得
    const targetDoc = await adminDb.collection('users').doc(targetUid).get();
    if (!targetDoc.exists) {
      return NextResponse.json({ error: '対象ユーザーが見つかりません' }, { status: 404 });
    }

    // Firestoreのユーザードキュメントを論理削除
    await adminDb.collection('users').doc(targetUid).update({
      deleted: true,
      deletedAt: FieldValue.serverTimestamp(),
      organizationIds: [], // 全ての組織から離脱
      updatedAt: FieldValue.serverTimestamp(),
    });

    // 組織のmembersサブコレクションから削除
    try {
      await adminDb.collection('organizations').doc(organizationId).collection('members').doc(targetUid).delete();
    } catch (e) {
      console.warn('[API] Failed to delete member document:', e);
    }

    // Firebase Authenticationのアカウントを削除
    try {
      await adminAuth.deleteUser(targetUid);
    } catch (e) {
      console.warn('[API] Failed to delete auth user:', e);
    }

    return NextResponse.json({
      success: true,
      message: 'ユーザーを削除しました',
    });
  } catch (error: any) {
    console.error('[API] delete-user error:', error);
    return NextResponse.json({ 
      error: 'ユーザーの削除に失敗しました',
      details: error.message || error.toString()
    }, { status: 500 });
  }
}
