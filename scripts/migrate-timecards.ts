// タイムカードにstatusフィールドを追加する移行スクリプト
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Firebase Admin SDKの初期化
// 注: サービスアカウントキーが必要です
// initializeApp({
//   credential: cert('./serviceAccountKey.json')
// });

// または環境変数から初期化
initializeApp();

const db = getFirestore();

async function migrateTimecards() {
  console.log('タイムカードの移行を開始します...');
  
  try {
    // すべてのタイムカードを取得
    const timecardsSnapshot = await db.collection('timecards').get();
    
    console.log(`${timecardsSnapshot.size}件のタイムカードが見つかりました`);
    
    let updatedCount = 0;
    let skippedCount = 0;
    
    // バッチ処理
    const batch = db.batch();
    
    for (const doc of timecardsSnapshot.docs) {
      const data = doc.data();
      
      // statusフィールドがない場合のみ追加
      if (!data.status) {
        // clockOutAtがあれば'approved'、なければ'draft'
        const status = data.clockOutAt ? 'approved' : 'draft';
        
        batch.update(doc.ref, { 
          status,
          updatedAt: new Date()
        });
        
        console.log(`ドキュメント ${doc.id}: status=${status} を追加`);
        updatedCount++;
      } else {
        console.log(`ドキュメント ${doc.id}: statusあり (${data.status}) - スキップ`);
        skippedCount++;
      }
    }
    
    if (updatedCount > 0) {
      await batch.commit();
      console.log(`\n✅ ${updatedCount}件のタイムカードを更新しました`);
    } else {
      console.log('\n✅ 更新が必要なタイムカードはありませんでした');
    }
    
    console.log(`📊 スキップ: ${skippedCount}件`);
    
  } catch (error) {
    console.error('❌ エラーが発生しました:', error);
    throw error;
  }
}

// スクリプト実行
migrateTimecards()
  .then(() => {
    console.log('\n移行が完了しました');
    process.exit(0);
  })
  .catch((error) => {
    console.error('移行に失敗しました:', error);
    process.exit(1);
  });
