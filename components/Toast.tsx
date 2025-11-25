'use client';

import React, { useState, useEffect, createContext, useContext } from 'react';
import { CheckCircle, XCircle, AlertCircle, X } from 'lucide-react';

// トーストの型定義
type ToastType = 'success' | 'error' | 'info' | 'confirm';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  title?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  duration?: number;
}

interface ToastContextType {
  showSuccessToast: (message: string, duration?: number) => void;
  showErrorToast: (message: string, duration?: number) => void;
  showInfoToast: (message: string, duration?: number) => void;
  showConfirmToast: (message: string, options?: {
    title?: string;
    confirmText?: string;
    cancelText?: string;
  }) => Promise<boolean>;
}

const ToastContext = createContext<ToastContextType | null>(null);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
};

// トーストプロバイダー
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  const addToast = (toast: Omit<Toast, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    const newToast = { ...toast, id };
    setToasts((prev) => [...prev, newToast]);

    if (toast.duration !== Infinity && toast.type !== 'confirm') {
      setTimeout(() => removeToast(id), toast.duration || 3000);
    }

    return id;
  };

  const showSuccessToast = (message: string, duration = 3000) => {
    addToast({ type: 'success', message, duration });
  };

  const showErrorToast = (message: string, duration = 4000) => {
    addToast({ type: 'error', message, duration });
  };

  const showInfoToast = (message: string, duration = 3000) => {
    addToast({ type: 'info', message, duration });
  };

  const showConfirmToast = (
    message: string,
    options?: {
      title?: string;
      confirmText?: string;
      cancelText?: string;
    }
  ): Promise<boolean> => {
    return new Promise((resolve) => {
      const id = addToast({
        type: 'confirm',
        message,
        title: options?.title,
        confirmText: options?.confirmText,
        cancelText: options?.cancelText,
        duration: Infinity,
        onConfirm: () => {
          removeToast(id);
          resolve(true);
        },
        onCancel: () => {
          removeToast(id);
          resolve(false);
        },
      });
    });
  };

  return (
    <ToastContext.Provider value={{ showSuccessToast, showErrorToast, showInfoToast, showConfirmToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
};

// トーストコンテナ
const ToastContainer: React.FC<{ toasts: Toast[]; onRemove: (id: string) => void }> = ({
  toasts,
  onRemove,
}) => {
  // confirm系とそれ以外で分けて描画
  const confirmToasts = toasts.filter(t => t.type === 'confirm');
  const normalToasts = toasts.filter(t => t.type !== 'confirm');
  return (
    <>
      {/* confirm: 画面中央＋背景 */}
      {confirmToasts.length > 0 && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40">
          {confirmToasts.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
          ))}
        </div>
      )}
      {/* 通常: 画面中央下 */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[999] flex flex-col gap-2 pointer-events-none">
        {normalToasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
        ))}
      </div>
    </>
  );
};

// 個別トーストアイテム
const ToastItem: React.FC<{ toast: Toast; onRemove: (id: string) => void }> = ({ toast, onRemove }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setTimeout(() => setVisible(true), 10);
  }, []);

  const handleRemove = () => {
    setVisible(false);
    setTimeout(() => onRemove(toast.id), 300);
  };

  if (toast.type === 'confirm') {
    return (
      <div
        className={`pointer-events-auto bg-white rounded-xl shadow-2xl border border-gray-200 p-6 max-w-md w-full transition-all duration-300 ${
          visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
        }`}
        role="alertdialog"
      >
        <div className="flex items-start gap-3">
          <AlertCircle className="w-6 h-6 text-orange-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            {toast.title && (
              <h3 className="font-semibold text-gray-900 mb-1">{toast.title}</h3>
            )}
            <p className="text-gray-700 text-base whitespace-pre-line">{toast.message}</p>
          </div>
          <button
            onClick={() => toast.onCancel?.()}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="閉じる"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex gap-3 mt-6 justify-end">
          <button
            onClick={() => toast.onCancel?.()}
            className="px-5 py-2 text-base font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors duration-200"
            autoFocus
          >
            {toast.cancelText || 'キャンセル'}
          </button>
          <button
            onClick={() => toast.onConfirm?.()}
            className="px-5 py-2 text-base font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors duration-200"
          >
            {toast.confirmText || '確認'}
          </button>
        </div>
      </div>
    );
  }

  const styles = {
    success: {
      bg: 'bg-green-50',
      border: 'border-green-200',
      text: 'text-green-800',
      icon: <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />,
    },
    error: {
      bg: 'bg-red-50',
      border: 'border-red-200',
      text: 'text-red-800',
      icon: <XCircle className="w-5 h-5 text-red-600 flex-shrink-0" />,
    },
    info: {
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      text: 'text-blue-800',
      icon: <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0" />,
    },
  };

  const style = styles[toast.type as keyof typeof styles];

  return (
    <div
      className={`pointer-events-auto flex items-center gap-3 px-4 py-3 ${style.bg} border ${style.border} rounded-lg shadow-lg transition-all duration-300 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
      }`}
      style={{ minWidth: '300px' }}
    >
      {style.icon}
      <span className={`font-medium ${style.text} text-sm flex-1`}>{toast.message}</span>
      <button
        onClick={handleRemove}
        className="text-gray-400 hover:text-gray-600 transition-colors ml-2"
        aria-label="閉じる"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

