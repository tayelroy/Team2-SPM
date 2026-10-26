import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Role } from '../mock/types';

/** A select-only combobox so the open menu uses the same theme as its trigger. */
export default function RoleSwitcher({ role, roles, onSwitchRole }: {
  role: Role;
  roles: readonly Role[];
  onSwitchRole: (role: Role) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef({ text: '', at: 0 });
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      if (!container.current!.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('focusin', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('focusin', dismiss);
    };
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${menuId}-${active}`)!.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [open, active, menuId]);

  function openMenu() {
    search.current = { text: '', at: 0 };
    setActive(roles.indexOf(role));
    setOpen(true);
  }

  function choose(next: Role) {
    setOpen(false);
    trigger.current!.focus();
    if (next !== role) onSwitchRole(next);
  }

  function handleKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key.length !== 1) search.current = { text: '', at: 0 };
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) openMenu();
      else setActive(index => (index + (event.key === 'ArrowDown' ? 1 : roles.length - 1)) % roles.length);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      openMenu();
      setActive(event.key === 'Home' ? 0 : roles.length - 1);
    } else if (open && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      choose(roles[active]);
    } else if (event.key === 'Tab') {
      if (open) choose(roles[active]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    } else if (event.key.length === 1 && event.key !== ' ' && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      const now = Date.now();
      const text = (open && now - search.current.at < 1000 ? search.current.text : '') + event.key.toLowerCase();
      const repeated = [...text].every(character => character === text[0]);
      const prefix = repeated ? text[0] : text;
      const start = repeated && open ? active + 1 : 0;
      const matching = roles.map((_, index) => (start + index) % roles.length)
        .find(index => roles[index].toLowerCase().startsWith(prefix));
      if (!open) openMenu();
      search.current = { text, at: now };
      if (matching !== undefined) setActive(matching);
    }
  }

  return (
    <div className="app-role-switcher" ref={container}>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label="Acting as"
        aria-expanded={open}
        aria-controls={menuId}
        aria-haspopup="listbox"
        aria-activedescendant={open ? `${menuId}-${active}` : undefined}
        className="role-switcher-trigger"
        onClick={() => open ? setOpen(false) : openMenu()}
        onKeyDown={handleKey}
      >
        <span className="role-switcher-current">{role}</span>
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" className="role-switcher-chevron">
          <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="role-switcher-menu">
          <div className="role-switcher-heading">Switch role</div>
          <div id={menuId} role="listbox" aria-label="Available roles">
            {roles.map((held, index) => (
              <button
                key={held}
                id={`${menuId}-${index}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={held === role}
                data-active={index === active}
                className="role-switcher-option"
                onPointerMove={() => setActive(index)}
                onClick={() => choose(held)}
              >
                <span>{held}</span>
                {held === role && <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="m3 8 3 3 7-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
