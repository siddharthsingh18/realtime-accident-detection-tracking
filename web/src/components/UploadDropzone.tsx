import React, { useState, useRef } from "react";
import { useSessionStore } from "../store/useSessionStore";
import { useShallow } from "zustand/react/shallow";
import { UploadCloud, FileVideo, X, AlertCircle } from "lucide-react";

export const UploadDropzone: React.FC = () => {
  const { uploadedFile, setUploadedFile } = useSessionStore(
    useShallow((s) => ({
      uploadedFile: s.uploadedFile,
      setUploadedFile: s.setUploadedFile,
    }))
  );
  const [isDragOver, setIsDragOver] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const allowedExtensions = [".mp4", ".avi", ".mov", ".mkv"];
  const maxBytes = 500 * 1024 * 1024; // 500MB

  const validateAndSetFile = (file: File) => {
    setErrorMsg(null);
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!allowedExtensions.includes(ext)) {
      setErrorMsg(`Invalid file type (${ext}). Supported: .mp4, .avi, .mov, .mkv`);
      return;
    }
    if (file.size > maxBytes) {
      setErrorMsg("File exceeds 500 MB size limit.");
      return;
    }
    setUploadedFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className="w-full">
      <input
        ref={fileInputRef}
        type="file"
        accept=".mp4,.avi,.mov,.mkv"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            validateAndSetFile(e.target.files[0]);
          }
        }}
      />

      {!uploadedFile ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
            isDragOver
              ? "border-emerald-500 bg-emerald-950/20"
              : "border-slate-700 bg-slate-900/40 hover:border-slate-600 hover:bg-slate-900/70"
          }`}
        >
          <UploadCloud className="w-10 h-10 text-slate-400 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-200">
            Click to upload or drag & drop traffic video
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Supports MP4, AVI, MOV, MKV (Max: 500 MB)
          </p>
        </div>
      ) : (
        <div className="flex items-center justify-between p-3.5 bg-slate-900/80 border border-slate-700 rounded-xl">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="p-2 rounded-lg bg-emerald-950/60 border border-emerald-700 text-emerald-400">
              <FileVideo className="w-5 h-5" />
            </div>
            <div className="truncate">
              <div className="text-sm font-semibold text-slate-200 truncate">
                {uploadedFile.name}
              </div>
              <div className="text-xs text-slate-400 font-mono">
                {(uploadedFile.size / (1024 * 1024)).toFixed(2)} MB
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              setUploadedFile(null);
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
            className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition"
            title="Remove file"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="mt-2 text-xs text-rose-400 flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5" />
          <span>{errorMsg}</span>
        </div>
      )}
    </div>
  );
};

