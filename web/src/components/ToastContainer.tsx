import React from "react";
import { useSessionStore } from "../store/useSessionStore";
import { useShallow } from "zustand/react/shallow";
import { useNavigate } from "react-router-dom";
import { AlertOctagon, CheckCircle2, RotateCcw, X } from "lucide-react";

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useSessionStore(
    useShallow((s) => ({
      toasts: s.toasts,
      removeToast: s.removeToast,
    }))
  );
  const navigate = useNavigate();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-12 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((toast) => {
        const isAlert = toast.type === "confirmed";
        const isUndo = toast.type === "undo";

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto p-3.5 rounded-xl border shadow-2xl backdrop-blur transition-all duration-300 animate-slide-up ${
              isAlert
                ? "bg-red-950/90 border-red-700 text-white shadow-red-950/50"
                : isUndo
                ? "bg-blue-950/90 border-blue-700 text-white"
                : "bg-slate-900/95 border-slate-700 text-slate-100"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <div className="mt-0.5">
                  {isAlert ? (
                    <AlertOctagon className="w-5 h-5 text-yellow-300 animate-pulse" />
                  ) : (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  )}
                </div>
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider">{toast.title}</div>
                  <div className="text-[11px] text-slate-200 mt-0.5">{toast.message}</div>
                </div>
              </div>

              <button
                onClick={() => removeToast(toast.id)}
                className="text-slate-400 hover:text-white p-0.5 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isAlert && (
              <div className="mt-2.5 pt-2 border-t border-red-800/80 flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    removeToast(toast.id);
                    // Snooze for 5 min
                  }}
                  className="px-2 py-1 rounded bg-black/40 hover:bg-black/60 text-[10px] font-semibold text-slate-300"
                >
                  Snooze 5m
                </button>
                <button
                  onClick={() => {
                    removeToast(toast.id);
                    navigate("/incidents");
                  }}
                  className="px-2.5 py-1 rounded bg-white text-red-950 hover:bg-slate-200 text-[10px] font-black uppercase"
                >
                  Review
                </button>
              </div>
            )}

            {isUndo && toast.undoAction && (
              <div className="mt-2 pt-2 border-t border-blue-800/80 flex items-center justify-end">
                <button
                  onClick={() => {
                    toast.undoAction!();
                    removeToast(toast.id);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Undo</span>
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

