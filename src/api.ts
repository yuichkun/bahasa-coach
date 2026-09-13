import { abortable } from "../shared/async";
export async function api<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });
  const timeoutMs = options.timeoutMs ?? (method === "GET" ? 15_000 : 240_000);
  const timer = setTimeout(
    () =>
      controller.abort(
        new Error("サーバーの応答が制限時間を超えました。接続を確認して再試行してください。"),
      ),
    timeoutMs,
  );
  const init: RequestInit = { method, signal: controller.signal };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  try {
    controller.signal.throwIfAborted();
    const response = await abortable(fetch(`/api${path}`, init), controller.signal);
    const value = await abortable(response.json(), controller.signal);
    if (!response.ok)
      throw new Error(value.error || `処理に失敗しました（HTTP ${response.status}）。`);
    return value;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
