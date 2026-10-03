import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, ChevronDown } from 'lucide-react';
import { Icon } from '../common/Icons';

interface MenuAction {
  label: string;
  icon: string;
  description?: string;
  danger?: boolean;
  onSelect: () => void;
}

interface Props {
  label: string;
  text?: string;
  disabled?: boolean;
  actions: MenuAction[];
}

export const DeviceActionMenu: React.FC<Props> = ({ label, text, disabled, actions }) => {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const close = (restoreFocus = false) => {
    setPosition(null);
    if (restoreFocus) trigger.current?.focus();
  };
  const toggle = () => {
    if (position) { close(); return; }
    const rect = trigger.current!.getBoundingClientRect();
    const width = text ? 272 : 216;
    const height = actions.reduce((sum, action) => sum + (action.description ? 62 : 40), 12);
    setPosition({
      left: Math.max(8, Math.min(text ? rect.left : rect.right - width, window.innerWidth - width - 8)),
      top: Math.max(8, rect.bottom + height + 8 < window.innerHeight ? rect.bottom + 6 : rect.top - height - 6),
    });
  };

  useEffect(() => {
    if (!position) return;
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(true); }
    };
    const dismiss = () => close();
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [position]);

  return <>
    <button ref={trigger} className={text ? 'btn device-more-trigger' : 'icon-btn device-more-trigger'}
      aria-label={label} title={label} aria-haspopup="menu" aria-expanded={!!position}
      disabled={disabled} onClick={toggle}
      onKeyDown={(event) => { if (event.key === 'ArrowDown' && !position) { event.preventDefault(); toggle(); } }}>
      {text ? <>{text}<ChevronDown size={14} aria-hidden="true" /></> : <MoreHorizontal size={18} aria-hidden="true" />}
    </button>
    {position && createPortal(<div ref={menu} role="menu" aria-label={label}
      className={'device-action-menu' + (text ? ' with-descriptions' : '')} style={position}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) close();
      }}
      onKeyDown={(event) => {
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 :
            (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }
      }}>
      {actions.map((action) => <button key={action.label} role="menuitem" className={action.danger ? 'danger' : ''}
        onClick={() => { close(true); action.onSelect(); }}>
        <Icon name={action.icon} aria-hidden="true" />
        <span><strong>{action.label}</strong>{action.description && <small>{action.description}</small>}</span>
      </button>)}
    </div>, document.body)}
  </>;
};
