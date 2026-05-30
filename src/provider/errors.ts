import vscode from 'vscode';
import { logger } from '../logger';

/**
 * Render a DeepSeek API error response into a single readable line,
 * preferring the structured `error.message` field when present so the user
 * sees the actual cause instead of a wall of JSON.
 */
export function formatApiError(status: number, statusText: string, body: string): string {
  const head = `DeepSeek API error: ${status} ${statusText}`;
  if (!body) return head;
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string; code?: string; type?: string };
    };
    const errMsg = parsed?.error?.message;
    if (typeof errMsg === 'string' && errMsg) {
      const code = parsed.error?.code ? ` [${parsed.error.code}]` : '';
      return `${head}${code}: ${errMsg}`;
    }
  } catch {
    /* fall through to raw body */
  }
  return `${head}\n${body.slice(0, 400)}`;
}

/**
 * Surface actionable buttons for the common 4xx errors. Fire-and-forget —
 * the underlying error still throws. We only show actionable popups for
 * conditions the user can do something about: 401 (key), 402 (billing),
 * 422 (host out of sync), 429 (transient — already retried), and the
 * specific 400 that's caused by missing reasoning chain.
 */
export async function notifyApiError(status: number, summary: string): Promise<void> {
  if (status === 401) {
    const choice = await vscode.window.showErrorMessage(
      vscode.l10n.t('deepseek-pilot.error.401', summary),
      vscode.l10n.t('deepseek-pilot.error.updateApiKey'),
    );
    if (choice === vscode.l10n.t('deepseek-pilot.error.updateApiKey')) {
      void vscode.commands.executeCommand('deepseek-pilot.setApiKey');
    }
    return;
  }
  if (status === 402) {
    const choice = await vscode.window.showErrorMessage(
      vscode.l10n.t('deepseek-pilot.error.402', summary),
      vscode.l10n.t('deepseek-pilot.error.openBilling'),
    );
    if (choice === vscode.l10n.t('deepseek-pilot.error.openBilling')) {
      void vscode.env.openExternal(vscode.Uri.parse('https://platform.deepseek.com/usage'));
    }
    return;
  }
  if (status === 422) {
    const choice = await vscode.window.showErrorMessage(
      vscode.l10n.t('deepseek-pilot.error.422', summary),
      vscode.l10n.t('deepseek-pilot.error.reloadWindow'),
    );
    if (choice === vscode.l10n.t('deepseek-pilot.error.reloadWindow')) {
      void vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
    return;
  }
  if (status === 429) {
    void vscode.window.showWarningMessage(
      vscode.l10n.t('deepseek-pilot.error.429'),
    );
    return;
  }
  if (status === 400) {
    const lower = summary.toLowerCase();
    // Specific 400 caused by reasoning_content gap in a multi-turn thinking
    // conversation, or by tool_call ordering issues.
    if (
      lower.includes('reasoning') ||
      lower.includes('thinking') ||
      lower.includes("role 'tool'")
    ) {
      const choice = await vscode.window.showErrorMessage(
        vscode.l10n.t('deepseek-pilot.error.400', summary),
        vscode.l10n.t('deepseek-pilot.error.startNewChat'),
        vscode.l10n.t('deepseek-pilot.error.showLogs'),
      );
      if (choice === vscode.l10n.t('deepseek-pilot.error.startNewChat')) {
        void vscode.commands.executeCommand('workbench.action.chat.newChat');
      } else if (choice === vscode.l10n.t('deepseek-pilot.error.showLogs')) {
        void vscode.commands.executeCommand('deepseek-pilot.showLogs');
      }
      return;
    }
  }
  // 500 / 503 are already retried by fetchWithRetry; if we land here the
  // retries also failed. Surface a non-blocking notification so the user
  // knows it's a server-side problem, not a misconfiguration.
  if (status === 500 || status === 503) {
    void vscode.window.showWarningMessage(
      vscode.l10n.t('deepseek-pilot.error.500', String(status)),
    );
    return;
  }
}

/**
 * Fetch with retry on transient failures (network errors, 5xx, 429).
 * 4xx (except 429) are non-retryable client errors and bubble immediately.
 * Aborts (user cancel) bypass retry.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  attempts = 3,
  timeoutMs = 300_000, // 5 min per attempt
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i += 1) {
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    try {
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const combinedSignal = AbortSignal.any([signal, timeoutSignal]);
      const res = await fetch(url, { ...init, signal: combinedSignal });
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
        return res;
      }
      lastErr = new Error(`HTTP ${res.status} ${res.statusText}`);
      logger.warn(
        `retry attempt=${i + 1} status=${res.status} willRetry=${i < attempts - 1}`,
      );
      try {
        await res.text();
      } catch {
        /* drain ignored */
      }
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') {
        if (signal.aborted) throw e;
        lastErr = new Error(`Request timeout after ${timeoutMs}ms`);
        logger.warn(`retry attempt=${i + 1} timeout=${timeoutMs}ms willRetry=${i < attempts - 1}`);
      } else {
        lastErr = e;
        logger.warn(
          `retry attempt=${i + 1} error=${e instanceof Error ? e.message : String(e)} willRetry=${i < attempts - 1}`,
        );
      }
    }
    if (i < attempts - 1) {
      const delayMs = 1000 * Math.pow(2, i);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
