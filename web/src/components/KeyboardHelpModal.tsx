import React, { useEffect } from "react";
import { useSessionStore } from "../store/useSessionStore";
import { useShallow } from "zustand/react/shallow";
import { Keyboard, X } from "lucide-react";

export const KeyboardHelpModal: React.FC = () => {
  const { isKeyboardHelpOpen, setKeyboardHelpOpen } = useSessionStore(
    useShallow((s) => ({
      isKeyboardHelpOpen: s.isKeyboardHelpOpen,
      setKeyboardHelpOpen: s.setKeyboardHelpOpen,
    }))
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        const active = document.activeElement;
        if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;
        setKeyboardHelpOpen(!isKeyboardHelpOpen);
      } else if (e.key === "Escape" && isKeyboardHelpOpen) {
        setKeyboardHelpOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isKeyboardHelpOpen, setKeyboardHelpOpen]);

  if (!isKeyboardHelpOpen) return null;

  const shortcuts = [
    { key: "Space", desc: "Pause / Resume live video stream" },
    { key: "Esc", desc: "Stop active stream / Dismiss modal" },
    { key: "⌘/Ctrl + K", desc: "Open Command Palette" },
    { key: "?", desc: "Toggle Keyboard Shortcuts Map" },
    { key: "1 / 2 / 4", desc: "Switch Live Wall grid layout (1, 2, or 4 tiles)" },
    { key: "J / K", desc: "Navigate Up / Down in Incident Review Queue" },
    { key: "T", desc: "Mark selected incident as True Accident" },
    { key: "F", desc: "Mark selected incident as False Alarm" },
    { key: "U", desc: "Mark selected incident as Unsure" },
    { key: "Enter", desc: "Open selected incident detail view" },
    { key: "M", desc: "Toggle audible alarm chime mute state" },
  ];

  return (
    <div
      onClick={() => setKeyboardHelpOpen(false)}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-slate-900 border border-slate-700 w-full max-w-md rounded-2xl shadow-2xl p-5"
      >
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
          <div className="flex items-center gap-2">
            <Keyboard className="w-5 h-5 text-emerald-400" />
            <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider">
              Operator Keyboard Shortcuts
            </h3>
          </div>
          <button
            onClick={() => setKeyboardHelpOpen(false)}
            className="p-1 text-slate-400 hover:text-white rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {shortcuts.map((sc) => (
            <div key={sc.key} className="flex items-center justify-between text-xs py-1 border-b border-slate-800/60">
              <span className="font-mono bg-slate-800 border border-slate-700 px-2 py-0.5 rounded text-emerald-300 font-bold">
                {sc.key}
              </span>
              <span className="text-slate-300">{sc.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

