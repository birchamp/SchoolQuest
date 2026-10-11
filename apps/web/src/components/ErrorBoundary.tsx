import { Component, type ErrorInfo, type ReactNode } from "react";
import { recordDiagnostic } from "../lib/diagnostics";

/**
 * Keeps one broken screen from taking the whole app with it.
 *
 * Without a boundary, a render error anywhere -- one odd date in a visualization, a field a
 * saved plan does not carry -- unmounts the entire tree, and the student is left with a blank
 * page and no tabs to get away from it. Wrapped around each tab and each large drawing, the
 * failure stays in its own card: the header, the other tabs and Setup keep working, and
 * "Try again" draws the part again without a reload.
 *
 * Plain words whatever the theme. A crash is not a moment for metaphor, and `area` already
 * arrives in the student's chosen wording from the caller.
 */
export class ErrorBoundary extends Component<
  { area: string; children: ReactNode },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown): { error: Error } {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // The message and where it happened, never the data being drawn: this log is something a
    // student pastes into an email.
    const where = info.componentStack?.trim().split("\n")[0]?.trim() ?? "";
    const message = error instanceof Error ? error.message : String(error);
    recordDiagnostic("render", `${this.props.area}: ${message}${where ? ` (${where})` : ""}`);
  }

  private readonly reset = () => this.setState({ error: null });

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <section className="card" role="alert" data-testid="error-boundary">
        <h2>{this.props.area}</h2>
        <p style={{ margin: "0 0 0.6rem" }}>This part could not be shown just now.</p>
        <p className="muted" style={{ margin: "0 0 0.7rem" }}>
          Everything else still works, and nothing you saved has changed. If it keeps happening,
          Report a problem on Setup sends the details.
        </p>
        <div className="button-row">
          <button type="button" className="action" onClick={this.reset}>
            Try again
          </button>
        </div>
      </section>
    );
  }
}
