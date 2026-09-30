import React, { useEffect } from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { Icon } from './Icons';

export const ConfirmModal: React.FC = () => {
  const { confirmDialog, closeConfirm } = useSnmp();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && confirmDialog) {
        closeConfirm();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [confirmDialog, closeConfirm]);

  if (!confirmDialog) return null;

  return (
    <div className="modal" onClick={closeConfirm}>
      <div
        className="sheet narrow"
        role="alertdialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <h2>
            {confirmDialog.danger && (
              <span style={{ color: 'var(--danger)' }}>
                <Icon name="i-triangle-alert" />
              </span>
            )}
            {confirmDialog.title}
          </h2>
          <button className="icon-btn" onClick={closeConfirm} aria-label="ปิด">
            <Icon name="i-x" />
          </button>
        </div>
        <div
          className="sheet-body"
          dangerouslySetInnerHTML={{ __html: confirmDialog.body }}
        />
        <div className="sheet-foot">
          <button
            className="btn"
            onClick={() => {
              if (confirmDialog.onCancel) confirmDialog.onCancel();
              closeConfirm();
            }}
          >
            ยกเลิก
          </button>
          <button
            className={`btn ${confirmDialog.danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={confirmDialog.onConfirm}
          >
            {confirmDialog.okText || 'ยืนยัน'}
          </button>
        </div>
      </div>
    </div>
  );
};
