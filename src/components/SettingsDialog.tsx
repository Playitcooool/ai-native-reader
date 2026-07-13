import { useEffect, useRef } from "react";
import SettingsPanel from "./SettingsPanel";
import { Icon } from "./Icons";

export function wrappedFocusTarget<T>(controls: T[], active: T | null, backwards: boolean): T | null {
  if (controls.length === 0) return null;
  if (backwards && active === controls[0]) return controls[controls.length - 1];
  if (!backwards && active === controls[controls.length - 1]) return controls[0];
  return null;
}

export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef(
    globalThis.document?.activeElement instanceof HTMLElement ? globalThis.document.activeElement : null,
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      "button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])",
    )).filter((element) => element.offsetParent !== null);
    focusable()[0]?.focus();

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onClose(); return; }
      if (event.key !== "Tab") return;
      const controls = focusable();
      const target = wrappedFocusTarget(
        controls,
        document.activeElement instanceof HTMLElement ? document.activeElement : null,
        event.shiftKey,
      );
      if (target) {
        event.preventDefault();
        target.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      requestAnimationFrame(() => returnFocusRef.current?.focus());
    };
  }, [onClose]);

  return (
    <div className="settings-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="settings-dialog-header">
          <h2 id="settings-title">Settings</h2>
          <button className="settings-close" onClick={onClose} aria-label="Close settings">
            <Icon name="close" />
          </button>
        </div>
        <SettingsPanel />
      </div>
    </div>
  );
}
