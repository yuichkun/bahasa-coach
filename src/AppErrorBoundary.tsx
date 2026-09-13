import { Component, type ErrorInfo, type ReactNode } from "react";
import { errorMessage, reportError } from "../shared/errors";

export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError("ui.crash", error);
    console.error("[ui.crash:component]", info.componentStack);
  }
  render() {
    if (this.state.error)
      return (
        <main role="alert" className="app-failure">
          <h1>アプリでエラーが発生しました</h1>
          <p>
            正常に処理を続けられないため、画面を停止しました。詳細はコンソールに記録しています。
          </p>
          <p>{errorMessage(this.state.error)}</p>
          <button onClick={() => window.location.reload()}>アプリを再読み込み</button>
        </main>
      );
    return this.props.children;
  }
}
