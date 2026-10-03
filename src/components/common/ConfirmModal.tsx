import React from 'react';
import { useSnmp } from '../../context/SnmpContext';
import { Icon } from './Icons';
import { useDeviceDialog } from '../devices/useDeviceDialog';

export const ConfirmModal: React.FC = () => {
  const { confirmDialog, closeConfirm } = useSnmp();

  const dialogRef = useDeviceDialog(!!confirmDialog, closeConfirm, '[data-cancel]');

  if (!confirmDialog) return null;

  return (
    <div className="modal" onClick={closeConfirm}>
      <div
        className="sheet narrow"
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <h2 id="confirm-dialog-title">
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
            data-cancel
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
