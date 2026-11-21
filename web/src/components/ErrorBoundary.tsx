import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("UI ErrorBoundary caught an error:", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="min-h-[400px] flex flex-col items-center justify-center p-8 bg-slate-900 border border-rose-900 rounded-2xl text-center">
          <AlertTriangle className="w-12 h-12 text-rose-500 mb-3" />
          <h2 className="text-lg font-bold text-slate-100">Component Render Failed</h2>
          <p className="text-xs text-slate-400 mt-1 max-w-md font-mono bg-black/40 p-3 rounded border border-slate-800">
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <button
            onClick={this.handleReload}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-lg shadow transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reload Dashboard</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

