import React, { useState, useCallback, useRef } from 'react';

const useToast = () => {
  const [toasts, setToasts] = useState([]);
  const [exiting, setExiting] = useState(new Set());
  const toastIdRef = useRef(0);

  // Animate a toast out, then remove it from state
  const animateOut = useCallback((id, clearFn) => {
    if (clearFn) clearFn();
    setExiting((prev) => new Set(prev).add(id));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      setExiting((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 300); // matches slideOut animation duration
  }, []);

  const showToast = useCallback((message, type = 'success') => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);

    // Auto-dismiss after 3 seconds (+ 300 ms slide-out = 3.3 s total visible)
    const timeoutId = setTimeout(() => animateOut(id), 3000);

    return {
      dismiss: () => animateOut(id, () => clearTimeout(timeoutId)),
    };
  }, [animateOut]);

  const dismissToast = useCallback((id) => {
    animateOut(id);
  }, [animateOut]);

  return { toasts, exiting, showToast, dismissToast };
};

const Toast = ({ toasts, exiting = new Set(), onDismiss }) => {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        pointerEvents: 'none',
      }}
    >
      {toasts.map((toast) => {
        const isExiting = exiting.has(toast.id);
        return (
          <div
            key={toast.id}
            className={isExiting ? 'toast-exiting' : ''}
            style={{
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--glass-border)',
              borderLeft: toast.type === 'success' ? '4px solid #10B981' : '4px solid #F87171',
              borderRadius: '12px',
              padding: '16px',
              minWidth: '320px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              color: toast.type === 'success' ? '#10B981' : '#F87171',
              fontSize: '14px',
              fontWeight: '500',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
              pointerEvents: 'auto',
              animation: isExiting
                ? 'slideOut 0.3s cubic-bezier(0.4, 0, 1, 1) forwards'
                : 'slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            }}
          >
            <span>{toast.message}</span>
            <button
              onClick={() => onDismiss && onDismiss(toast.id)}
              style={{
                background: 'none',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                fontSize: '18px',
                padding: '0 0 0 12px',
                display: 'flex',
                alignItems: 'center',
                transition: 'opacity 0.2s',
              }}
              onMouseEnter={(e) => (e.target.style.opacity = '0.7')}
              onMouseLeave={(e) => (e.target.style.opacity = '1')}
            >
              ✕
            </button>
          </div>
        );
      })}

      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(400px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes slideOut {
          from { opacity: 1; transform: translateX(0); }
          to   { opacity: 0; transform: translateX(120%); }
        }
      `}</style>
    </div>
  );
};

export { Toast, useToast };
export default Toast;
