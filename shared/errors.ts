export function asError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error(typeof error === "string" ? error : "不明なエラー", { cause: error });
}

export function errorMessage(error: unknown) {
  return asError(error)
    .message.replace(/\bsk-[\w-]+|\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[REDACTED]")
    .slice(0, 2000);
}

// Log causes/stacks, never request bodies, credentials, or entire AI responses.
export function reportError(context: string, error: unknown) {
  const value = asError(error);
  console.error(
    `[${context}]`,
    value.name,
    errorMessage(value),
    value.stack?.replace(/\bsk-[\w-]+|\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[REDACTED]"),
  );
  if (value.cause instanceof Error)
    console.error(`[${context}:cause]`, value.cause.name, errorMessage(value.cause));
}
