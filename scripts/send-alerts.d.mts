export interface ScheduledAlert {
  id: string;
  at: number;
  text: string;
  _h: string;
}
export function openSealed(sealed: unknown, passphrase: string): Promise<string>;
export function hashId(id: string, salt: string): string;
export function dueAlerts<T extends ScheduledAlert>(alerts: T[], sent: Record<string, number>, now: number, windowMs: number): T[];
export function chunk(texts: string[], maxLen?: number): string[];
export function pruneSent(sent: Record<string, number>, now: number, keepMs?: number): Record<string, number>;
export function main(now?: number): Promise<void>;
