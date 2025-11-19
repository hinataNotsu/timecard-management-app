import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      {/* ヘッダー */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-2xl font-bold text-gray-900">タイムカード管理システム</h1>
        </div>
      </header>

      {/* メインコンテンツ */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-extrabold text-gray-900 mb-4">
            シフト管理と給与計算を
            <br />
            もっと簡単に
          </h2>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            アルバイトのシフト提出から給与計算まで、すべてをひとつのアプリで管理できます
          </p>
        </div>

        {/* ログイン・登録セクション */}
        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {/* アルバイト向け */}
          <div className="bg-white rounded-xl shadow-lg p-8 border-2 border-blue-100">
            <div className="mb-6">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">アルバイトの方</h3>
              <p className="text-gray-600">
                シフト提出や給与の確認が簡単にできます
              </p>
            </div>
            <div className="space-y-3">
              <Link
                href="/login/part-time"
                className="block w-full px-6 py-3 bg-blue-600 text-white text-center rounded-lg font-semibold hover:bg-blue-700 transition"
              >
                ログイン
              </Link>
              <Link
                href="/signup/part-time"
                className="block w-full px-6 py-3 bg-white text-blue-600 text-center rounded-lg font-semibold border-2 border-blue-600 hover:bg-blue-50 transition"
              >
                新規会員登録
              </Link>
            </div>
          </div>

          {/* 企業向け */}
          <div className="bg-white rounded-xl shadow-lg p-8 border-2 border-purple-100">
            <div className="mb-6">
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
                <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">企業の方</h3>
              <p className="text-gray-600">
                スタッフのシフト管理や給与計算を効率化
              </p>
            </div>
            <div className="space-y-3">
              <Link
                href="/login/company"
                className="block w-full px-6 py-3 bg-purple-600 text-white text-center rounded-lg font-semibold hover:bg-purple-700 transition"
              >
                ログイン
              </Link>
              <Link
                href="/signup/company"
                className="block w-full px-6 py-3 bg-white text-purple-600 text-center rounded-lg font-semibold border-2 border-purple-600 hover:bg-purple-50 transition"
              >
                企業登録
              </Link>
            </div>
          </div>
        </div>

        {/* 機能紹介 */}
        <div className="mt-24">
          <h3 className="text-3xl font-bold text-center text-gray-900 mb-12">主な機能</h3>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <h4 className="text-xl font-semibold text-gray-900 mb-2">シフト管理</h4>
              <p className="text-gray-600">簡単にシフトを提出・確認できます</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h4 className="text-xl font-semibold text-gray-900 mb-2">給与計算</h4>
              <p className="text-gray-600">自動で給与を計算し見込み額を表示</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h4 className="text-xl font-semibold text-gray-900 mb-2">タイムカード</h4>
              <p className="text-gray-600">出退勤の打刻を簡単に記録</p>
            </div>
          </div>
        </div>
      </main>

      {/* フッター */}
      <footer className="bg-gray-50 border-t border-gray-200 mt-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <p className="text-center text-gray-600">© 2025 タイムカード管理システム</p>
        </div>
      </footer>
    </div>
  );
}

