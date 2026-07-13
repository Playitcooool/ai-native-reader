import { useEffect, useRef } from "react";
import { Icon } from "./Icons";

interface ShortcutsModalProps {
  onClose: () => void;
  epub?: boolean;
}

const SHORTCUTS = [
  { key: "← →", desc: "Previous / Next page" },
  { key: "PgUp PgDn", desc: "Previous / Next page" },
  { key: "E", desc: "Explain selection" },
  { key: "Cmd/Ctrl+B", desc: "Highlight selection" },
  { key: "Esc", desc: "Clear selection" },
  { key: "Cmd/Ctrl+O", desc: "Open document" },
  { key: "?", desc: "Toggle this help" },
] as const;

export default function ShortcutsModal({ onClose, epub = false }: ShortcutsModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const close = () => dialogRef.current?.close();

  return (
    <dialog
      ref={dialogRef}
      className="shortcuts-dialog"
      aria-labelledby="shortcuts-title"
      onClose={onClose}
      onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
      onKeyDown={(event) => { if (event.key === "?") { event.preventDefault(); close(); } }}
    >
      <div className="shortcuts-content">
        <div className="shortcuts-header">
          <h2 id="shortcuts-title">Keyboard Shortcuts</h2>
          <button className="settings-close" onClick={close} aria-label="Close keyboard shortcuts" autoFocus>
            <Icon name="close" />
          </button>
        </div>
        <dl className="shortcuts-list">
          <dt><kbd>+ − 0</kbd></dt>
          <dd>{epub ? "Text size up / down / auto" : "Zoom in / out / reset"}</dd>
          {SHORTCUTS.map((shortcut) => (
            <div className="shortcuts-row" key={shortcut.key}>
              <dt><kbd>{shortcut.key}</kbd></dt>
              <dd>{shortcut.desc}</dd>
            </div>
          ))}
        </dl>
        <p className="shortcuts-hint">Click outside or press Esc to close</p>
      </div>
    </dialog>
  );
}
