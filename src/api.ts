export async function api<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`/api${path}`, init);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "処理に失敗しました。もう一度試してください。");
  return value;
}
