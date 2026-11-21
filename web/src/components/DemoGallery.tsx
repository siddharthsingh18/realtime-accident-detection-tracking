import React, { useEffect, useState } from "react";
import { DemoItem } from "../api/types";
import { api } from "../api/client";
import { Download, Film, AlertCircle, RefreshCw } from "lucide-react";

export const DemoGallery: React.FC = () => {
  const [demos, setDemos] = useState<DemoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDemos = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getDemos();
      setDemos(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to load demos: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDemos();
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-slate-900/40 border border-slate-800 rounded-xl">
        <RefreshCw className="w-8 h-8 text-slate-500 animate-spin mb-2" />
        <p className="text-sm text-slate-400">Loading pre-rendered H.264 demos...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-rose-950/40 border border-rose-800 rounded-xl text-center">
        <AlertCircle className="w-8 h-8 text-rose-400 mx-auto mb-2" />
        <p className="text-sm font-semibold text-rose-200">{error}</p>
        <button
          onClick={fetchDemos}
          className="mt-3 px-3 py-1.5 rounded-lg bg-rose-900/60 hover:bg-rose-800 text-xs font-medium text-rose-100 transition"
        >
          Retry
        </button>
      </div>
    );
  }

  if (demos.length === 0) {
    return (
      <div className="p-8 text-center bg-slate-900/40 border border-slate-800 rounded-xl text-slate-400">
        <Film className="w-10 h-10 mx-auto mb-2 text-slate-600" />
        <p className="text-sm font-medium">No pre-rendered demos found.</p>
        <p className="text-xs text-slate-500 mt-1">
          Generate demos using <code className="font-mono bg-slate-800 px-1 py-0.5 rounded">python scripts/reencode_demos.py</code>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider">
            Pre-Rendered Annotated Demos
          </h3>
          <p className="text-xs text-slate-400">
            H.264 video streams served with HTTP range support. Play directly or download.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {demos.map((demo) => (
          <div
            key={demo.name}
            className="bg-slate-900/80 border border-slate-800 rounded-xl overflow-hidden flex flex-col justify-between shadow-lg"
          >
            <div className="relative aspect-video bg-black">
              <video
                src={demo.video_url}
                controls
                preload="metadata"
                className="w-full h-full object-contain"
              />
            </div>
            <div className="p-4 flex-1 flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-sm font-bold text-slate-100">{demo.title}</h4>
                  <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-[10px] text-emerald-400">
                    {demo.codec.toUpperCase()}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">{demo.description}</p>
                <div className="flex items-center gap-3 mt-2 text-[11px] font-mono text-slate-500">
                  <span>Res: {demo.resolution}</span>
                  <span>•</span>
                  <span>FPS: {demo.fps}</span>
                  <span>•</span>
                  <span>Duration: {demo.duration_seconds.toFixed(1)}s</span>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-end">
                <a
                  href={demo.video_url}
                  download={`${demo.name}.mp4`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download MP4</span>
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

