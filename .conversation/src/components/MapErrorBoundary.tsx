import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { failed: boolean };

/**
 * Keeps a map/overlay glitch local. Without this, any throw inside the Leaflet
 * layers bubbles to the router boundary and replaces the whole app with the
 * "This page didn't load" screen — which is what players hit when a hunt
 * started. Here the map simply remounts itself instead.
 */
export default class MapErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[map] recovered from a render error", error, info.componentStack);
    // Remount on the next frame; the map rebuilds from current props.
    setTimeout(() => this.setState({ failed: false }), 120);
  }

  override render() {
    if (this.state.failed) return <div className="absolute inset-0 bg-background" />;
    return this.props.children;
  }
}
