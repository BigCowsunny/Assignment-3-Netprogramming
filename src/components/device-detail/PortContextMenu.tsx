import React, { useEffect, useRef } from 'react';
import { Device, Port } from '../../types/snmp';
import { Icon } from '../common/Icons';
import { fmtSpeed } from '../../utils/formatters';
import { configurationWarning } from '../../utils/deviceManagement';

interface PortContextMenuProps {
  device: Device;
  port: Port;
  x: number;
  y: number;
  onClose: () => void;
  onViewTraffic: () => void;
  onToggleAdmin: (turnDown: boolean) => void;
}

export const PortContextMenu: React.FC<PortContextMenuProps> = ({
  device,
  port,
  x,
  y,
  onClose,
  onViewTraffic,
  onToggleAdmin,
}) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const isUp = port.admin === 'up';
  const warning = configurationWarning(device);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Tab') onClose();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])];
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(current + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
      if (previous?.isConnected) previous.focus();
    };
  }, [onClose]);

  // Adjust position to stay on screen
  let posX = x;
  let posY = y;
  posX = Math.max(12, Math.min(posX, window.innerWidth - 292));
  posY = Math.max(12, Math.min(posY, window.innerHeight - 250));

  return (
    <div
      ref={menuRef}
      className="port-menu"
      style={{ left: `${posX}px`, top: `${posY}px` }}
      role="menu"
      aria-label={'จัดการ ' + port.name}
    >
      <div className="pm-head">
        <b>{port.name}</b>
        <div className="hint">
          {warning || `${fmtSpeed(port.speed)} · ifIndex ${port.idx} · ทดลอง SET และตรวจค่าจากอุปกรณ์`}
        </div>
      </div>

      <button
        role="menuitem"
        disabled={!!warning}
        title={warning}
        onClick={() => {
          onClose();
          onViewTraffic();
        }}
      >
        <Icon name="i-chart" />
        ดูกราฟทราฟฟิก
      </button>

      {isUp ? (
        <button
          role="menuitem"
          className="danger"
          disabled={!!warning}
          title={warning}
          onClick={() => {
            onClose();
            onToggleAdmin(true);
          }}
        >
          <Icon name="i-ban" />
          ปิดพอร์ต (Shutdown)
        </button>
      ) : (
        <button
          role="menuitem"
          disabled={!!warning}
          title={warning}
          onClick={() => {
            onClose();
            onToggleAdmin(false);
          }}
        >
          <Icon name="i-circle-check" />
          เปิดพอร์ต (No Shutdown)
        </button>
      )}
    </div>
  );
};
