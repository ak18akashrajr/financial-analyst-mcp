import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logClientError } from '@/lib/clientErrorLogging';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Top-level render-crash catcher, wrapped around the whole app in App.tsx. React error
 * boundaries only catch errors thrown during render/lifecycle in their subtree — uncaught JS
 * errors and unhandled promise rejections elsewhere are covered separately by
 * installGlobalErrorLogging() in main.tsx. Both funnel into the same public.app_logs table. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logClientError('ErrorBoundary', error.message, {
      name: error.name,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6 text-foreground">
          <div className="max-w-md space-y-3 text-center">
            <h1 className="text-lg font-semibold">Something went wrong</h1>
            <p className="text-sm text-muted-foreground">
              This has been logged. Try reloading — if it keeps happening, check the Dev Zone
              for the error details.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
