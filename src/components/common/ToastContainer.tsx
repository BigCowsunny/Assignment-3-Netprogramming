import React from 'react';
import { useSnmp } from '../../context/SnmpContext';

export const ToastContainer: React.FC = () => {
  const { toasts } = useSnmp();

  if (!toasts.length) return null;

  return (
    <div id="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <b>{t.title}</b>
          {t.body && <span className="mono">{t.body}</span>}
        </div>
      ))}
    </div>
  );
};
