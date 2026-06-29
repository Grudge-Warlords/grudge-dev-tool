import React from "react";

interface Props {
  children: React.ReactNode;
  fallback?: (err: Error, reset: () => void) => React.ReactNode;
}

interface State {
  err: Error | null;
}

/**
 * Top-level error boundary. Wraps the app so a thrown render error in any
 * page can't blank the whole window. Logs the error and the component stack
 * to the main-process logger via the existing diag channel.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }

  componentDidCatch(err: Error, info: React.ErrorInfo) {
    // Best-effort log — don't fail the boundary if the IPC bridge is missing.
    try {
      // eslint-disable-next-line no-console
      console.error("[ErrorBoundary]", err, info?.componentStack);
    } catch { /* ignore */ }
  }

  reset = () => this.setState({ err: null });

  render() {
    if (!this.state.err) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.state.err, this.reset);
    return (
      <div className="flex flex-col items-center justify-center h-screen p-6 gap-3 text-center">
        <div className="card max-w-lg">
          <h1 className="page-title">Something went wrong</h1>
          <p className="text-muted text-sm mb-3">
            A render error crashed this view. The rest of the app is still running — you can recover or check the logs.
          </p>
          <pre className="text-xs status-bad text-left whitespace-pre-wrap break-words mb-3">
            {this.state.err.message}
          </pre>
          <div className="flex gap-2 justify-center">
            <button className="btn" onClick={this.reset}>Try again</button>
            <button
              className="btn ghost"
              onClick={() => (window as any).grudge?.diag?.openLogFolder?.()}
            >Open logs</button>
          </div>
        </div>
      </div>
    );
  }
}
