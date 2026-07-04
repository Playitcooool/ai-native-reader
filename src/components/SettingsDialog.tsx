import { useEffect, useRef } from "react";
import SettingsPanel from "./SettingsPanel";
import { Icon } from "./Icons";

export default function SettingsDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const first = dialog?.querySelector<HTMLElement>("button, select, input, [tabindex]:not([tabindex='-1'])");
    first?.focus();

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
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
