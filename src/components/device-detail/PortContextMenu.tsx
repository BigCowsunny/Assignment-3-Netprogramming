import React, { useEffect, useRef } from 'react';
import { Device, Port } from '../../types/snmp';
import { Icon } from '../common/Icons';
import { fmtSpeed } from '../../utils/formatters';

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

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Adjust position to stay on screen
  let posX = x;
  let posY = y;
  if (posX + 230 > window.innerWidth - 10) posX = window.innerWidth - 240;
  if (posY + 120 > window.innerHeight - 10) posY = window.innerHeight - 130;

  return (
    <div
      ref={menuRef}
      className="port-menu"
      style={{ left: `${posX}px`, top: `${posY}px` }}
      role="menu"
    >
      <div className="pm-head">
        <b>{port.name}</b>
        <div className="hint">
          {fmtSpeed(port.speed)} · ifIndex {port.idx} ·{' '}
          ทดลอง SET และตรวจค่าจากอุปกรณ์
        </div>
      </div>

      <button
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
          className="danger"
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
