/**
 * Generic React error boundary. Wrap any subtree that might throw at
 * render-time so a bug in one page doesn't blank the whole app. The
 * boundary logs the captured error + stack to console and renders a
 * compact "something went wrong" panel with a retry button.
 *
 * Usage:
 *   <ErrorBoundary label="Storage">
 *     <SettingsStoragePage />
 *   </ErrorBoundary>
 */
import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  label?: string;
}
interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, info: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Console output is the primary debugging signal — a captured
    // stack here is far more actionable than a silent white screen.
    console.error(
      `[ErrorBoundary${this.props.label ? `:${this.props.label}` : ''}] caught:`,
      error,
      info,
    );
    this.setState({ error, info });
  }

  reset = (): void => {
    this.setState({ error: null, info: null });
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div
        style={{
          padding: 24,
          maxWidth: 720,
          margin: '40px auto',
          background: 'var(--tm-surface, #1f2937)',
          color: 'var(--tm-text, #e5e7eb)',
          border: '1px solid var(--tm-border, #374151)',
          borderRadius: 12,
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>
          Something went wrong
          {this.props.label ? ` in ${this.props.label}` : ''}
        </h2>
        <p style={{ margin: '0 0 12px', opacity: 0.85, fontSize: 13 }}>
          The page crashed during render. The browser console has the full
          stack trace — copy it to whoever's debugging.
        </p>
        <pre
          style={{
            padding: 12,
            background: 'rgba(0,0,0,0.35)',
            borderRadius: 6,
            fontSize: 12,
            overflow: 'auto',
            maxHeight: 240,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {this.state.error.message}
          {this.state.error.stack ? `\n\n${this.state.error.stack}` : ''}
        </pre>
        <button
          onClick={this.reset}
          style={{
            marginTop: 12,
            padding: '6px 14px',
            background: 'transparent',
            border: '1px solid currentColor',
            borderRadius: 6,
            color: 'inherit',
            cursor: 'pointer',
          }}
        >
          ↻ Retry
        </button>
      </div>
    );
  }
}
