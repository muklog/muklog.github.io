import React, { type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { hasErr: boolean; msg: string };

/**
 * 라우트 트리에서 잡히지 않는 렌더·라이프사이클 예외 폴백.
 * 사용자가 새로고침 없이 복귀 시도할 수 있게 한다.
 */
export class AppErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasErr: false, msg: "" };
  }

  static getDerivedStateFromError(e: unknown): Partial<State> {
    const msg = e instanceof Error ? e.message : String(e);
    return { hasErr: true, msg };
  }

  componentDidCatch(e: unknown, info: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("[AppErrorBoundary]", e, info.componentStack);
    }
  }

  render() {
    if (this.state.hasErr) {
      return (
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6 py-16 text-center">
          <p className="text-lg font-semibold text-slate-100">문제가 발생했어요</p>
          <p className="max-w-sm text-sm text-slate-400">
            예상하지 못한 오류예요. 다시 시도하거나 페이지를 새로고침해 주세요.
          </p>
          {import.meta.env.DEV && this.state.msg && (
            <pre className="max-h-32 max-w-full overflow-auto rounded-lg border border-slate-800 bg-slate-900 p-3 text-left text-[11px] text-rose-200/90">
              {this.state.msg}
            </pre>
          )}
          <div className="flex w-full max-w-xs flex-col gap-2">
            <button
              type="button"
              className="btn-primary py-2.5 text-sm font-medium"
              onClick={() => this.setState({ hasErr: false, msg: "" })}
            >
              다시 시도
            </button>
            <button
              type="button"
              className="btn-secondary py-2.5 text-sm"
              onClick={() => window.location.reload()}
            >
              새로고침
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
