import React from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { Icon } from './Icons';

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useSnmp();

  if (!toasts.length) return null;

  return (
    <div id="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <button className="icon-btn toast-close" aria-label="ปิดการแจ้งเตือน" onClick={() => removeToast(t.id)}><Icon name="i-x" size={14} /></button>
          <b>{t.title}</b>
          {t.body && <span className="mono">{t.body}</span>}
        </div>
      ))}
    </div>
  );
};
