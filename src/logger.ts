import vscode from 'vscode';

class Logger {
  private channel: vscode.OutputChannel;

  constructor() {
    this.channel = vscode.window.createOutputChannel('DeepSeek V4 QA');
  }

  info(message: string, data?: unknown): void {
    this.channel.appendLine(`[INFO] ${message}${data ? ' ' + JSON.stringify(data) : ''}`);
  }

  warn(message: string, data?: unknown): void {
    this.channel.appendLine(`[WARN] ${message}${data ? ' ' + JSON.stringify(data) : ''}`);
  }

  error(message: string, data?: unknown): void {
    this.channel.appendLine(`[ERROR] ${message}${data ? ' ' + JSON.stringify(data) : ''}`);
  }

  debug(message: string, data?: unknown): void {
    const enabled = vscode.workspace.getConfiguration('deepseek-qa').get<boolean>('debug', false);
    if (enabled) {
      this.channel.appendLine(`[DEBUG] ${message}${data ? ' ' + JSON.stringify(data) : ''}`);
    }
  }

  show(): void {
    this.channel.show();
  }

  dispose(): void {
    this.channel.dispose();
  }
}

export const logger = new Logger();
