import { createContext, useCallback, useContext, useState } from "react";

interface Toast {
  id: number;
  type: "success" | "error" | "info";
  message: string;
}

interface ToastCtx {
  addToast: (t: Omit<Toast, "id">) => void;
}

const Ctx = createContext<ToastCtx>({ addToast: () => {} });

export const useToast = () => useContext(Ctx);

let nextId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((t: Omit<Toast, "id">) => {
    const id = ++nextId;
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 3000);
  }, []);

  return (
    <Ctx.Provider value={{ addToast }}>
      {children}
      <div
        style={{
          position: "fixed",
          bottom: 16,
          right: 16,
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              padding: "10px 16px",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              color: "#fff",
              background: t.type === "error"
                ? "var(--danger-color)"
                : t.type === "success"
                  ? "var(--success-color)"
                  : "var(--accent-color)",
              boxShadow: "0 2px 12px rgba(0,0,0,0.2)",
              pointerEvents: "auto",
              animation: "toast-in 0.2s ease",
            }}
          >
            {t.message}
          </div>
        ))}
      </div>
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </Ctx.Provider>
  );
}
