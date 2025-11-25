'use client';

import { useEffect, useCallback, useRef } from 'react';
import { useToast } from '@/components/Toast';
import { useRouter } from 'next/navigation';

/**
 * フォームの未保存変更を検知し、ページ離脱時に確認ダイアログを表示するフック
 * @param hasUnsavedChanges - 未保存の変更があるかどうか
 * @param message - 確認ダイアログに表示するメッセージ（デフォルト: '変更が保存されていません。このページを離れますか?'）
 */
export function useUnsavedChanges(
  hasUnsavedChanges: boolean,
  message: string = '変更が保存されていません。このページを離れますか?'
) {
  const router = useRouter();
  const messageRef = useRef(message);

  // メッセージの更新
  useEffect(() => {
    messageRef.current = message;
  }, [message]);

  // ブラウザの戻る/進む、タブを閉じる、リロードなどを検知
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = messageRef.current;
        return messageRef.current;
      }
    };

    if (hasUnsavedChanges) {
      window.addEventListener('beforeunload', handleBeforeUnload);
    }

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [hasUnsavedChanges]);

  // Next.jsのルーティング変更を検知してconfirmダイアログを表示
  const { showConfirmToast } = useToast();

  // ルーティング変更時の確認（Promiseで返す）
  const handleRouteChange = useCallback(async () => {
    if (hasUnsavedChanges) {
      const confirmed = await showConfirmToast(messageRef.current, {
        title: '確認',
        confirmText: '離れる',
        cancelText: 'キャンセル',
      });
      return confirmed;
    }
    return true;
  }, [hasUnsavedChanges, showConfirmToast]);

  return { handleRouteChange };
}
