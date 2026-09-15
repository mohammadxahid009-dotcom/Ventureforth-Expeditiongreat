import { Component, type ErrorInfo, type ReactNode } from "react";

type ErrorBoundaryProps = {
  children: ReactNode;
  resetKey?: string;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Expedition interface error", error, info.componentStack);
  }

  componentDidUpdate(previousProps: ErrorBoundaryProps) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="grid min-h-[100dvh] place-items-center bg-background px-6 text-foreground">
        <section className="panel w-full max-w-md rounded-2xl p-6 text-center">
          <p className="text-[10px] uppercase tracking-[0.24em] text-accent">Instrument fault</p>
          <h1 className="mt-3 text-lg font-bold tracking-[0.12em]">EXPEDITION PAUSED</h1>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            The field console encountered an unexpected fault. Reload the expedition to try again.
          </p>
          <button
            type="button"
            className="mt-5 rounded-xl bg-primary px-4 py-3 text-[10px] font-bold tracking-[0.2em] text-primary-foreground"
            onClick={() => window.location.reload()}
          >
            RELOAD CONSOLE
          </button>
        </section>
      </main>
    );
  }
}