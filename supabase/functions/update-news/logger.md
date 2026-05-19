// supabase/functions/update-news/logger.ts: A simple class for collecting and formatting logs.
export class Logger {
  private logs: string[] = [];
  private summary: string[] = [];
  private startTime: number;

  constructor() {
    this.startTime = Date.now();
  }

  private add(level: string, message: string) {
    const timestamp = new Date().toISOString();
    let emoji = 'ℹ️';
    if (level === 'SUCCESS') emoji = '✅';
    if (level === 'WARN') emoji = '⚠️';
    if (level === 'ERROR') emoji = '🚨';

    const logMessage = `[${timestamp}] ${emoji} [${level}] ${message}`;
    this.logs.push(logMessage);
    // Also log to console for real-time debugging in Supabase logs
    if (level === 'ERROR') {
      console.error(logMessage);
    } else if (level === 'WARN') {
      console.warn(logMessage);
    } else {
      console.log(logMessage);
    }
  }

  info(message: string) { this.add('INFO', message); }
  warn(message: string) { this.add('WARN', message); }
  error(message: string) { this.add('ERROR', message); }
  success(message: string) { this.add('SUCCESS', message); }
  addSummary(message: string) { this.summary.push(message); }
  getLogs = (): string[] => this.logs;
  
  getSummary = (): string[] => {
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);
    return [
      `Start Time: ${new Date(this.startTime).toUTCString()}`,
      `End Time: ${new Date().toUTCString()}`,
      `Total Duration: ${duration} seconds`,
      ...this.summary
    ];
  };
}
