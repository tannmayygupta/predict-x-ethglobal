import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { COPY } from "../../copy";
import { KebabDots } from "./icons";

export interface KebabMenuProps {
  /** Token contract; copy and explorer entries are omitted when there is none. */
  address: string | null;
  explorerUrl: string | null;
  dashboardUrl: string | null;
}

/** How long the "Address copied" / "Could not copy" note stays. */
const NOTE_MS = 2000;

const ITEM =
  "flex h-9 w-full cursor-pointer items-center whitespace-nowrap rounded-input bg-transparent px-3 text-left text-14 text-text no-underline hover:bg-ink3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber";

/** 32x32 kebab with a small menu. Escape closes the menu first and stops there, so the card stays open. */
export function KebabMenu({ address, explorerUrl, dashboardUrl }: KebabMenuProps) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const away = (event: Event): void => {
      if (root.current && !event.composedPath().includes(root.current)) setOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open]);

  // The note clears itself; the timer is cleaned up so an unmounted card never sets state.
  useEffect(() => {
    if (note === null) return;
    const timer = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(timer);
  }, [note]);

  const keys = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    }
  };

  /** Close after an item and hand focus back, so the next Escape closes the card, not a ghost menu. */
  const done = (): void => {
    setOpen(false);
    trigger.current?.focus();
  };

  const copy = (): void => {
    done();
    if (!address) return;
    // navigator.clipboard is undefined on http pages; a blocked or missing clipboard is a visible state.
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clipboard) {
      setNote(COPY.copy_failed);
      return;
    }
    try {
      clipboard.writeText(address).then(
        () => setNote(COPY.copied),
        () => setNote(COPY.copy_failed),
      );
    } catch {
      setNote(COPY.copy_failed);
    }
  };

  return (
    <div ref={root} className="relative" onKeyDown={keys}>
      <button
        ref={trigger}
        type="button"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => { setNote(null); setOpen((v) => !v); }}
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-mute hover:bg-ink2 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber"
      >
        <KebabDots />
      </button>
      {open ? (
        <div id={menuId} role="menu" className="absolute right-0 top-9 z-10 flex min-w-[200px] flex-col rounded-card border border-rule bg-ink p-1 shadow-card">
          {address ? (
            <button type="button" role="menuitem" className={ITEM} onClick={copy}>{COPY.copy_address}</button>
          ) : null}
          {explorerUrl ? (
            <a role="menuitem" className={ITEM} href={explorerUrl} target="_blank" rel="noreferrer" onClick={done}>{COPY.view_basescan}</a>
          ) : null}
          {dashboardUrl ? (
            <a role="menuitem" className={ITEM} href={dashboardUrl} target="_blank" rel="noreferrer" onClick={done}>{COPY.open_dashboard}</a>
          ) : null}
        </div>
      ) : null}
      {/* Only shown while the menu is closed (opening it clears the note), so the two never overlap. */}
      {note && !open ? <span role="status" className="absolute right-0 top-9 whitespace-nowrap text-12 text-mute">{note}</span> : null}
    </div>
  );
}
