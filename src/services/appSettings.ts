import { API } from '../config/api';

export interface AppSettings {
  discovery_time: string;
  timezone: string;
  /** Automatic retries after a backup job fails. 0 disables. */
  job_retry_max: number;
  /** Minutes to wait between a failure and its retry. */
  job_retry_delay_minutes: number;
}

const JSON_HEADERS: Record<string, string> = { 'Content-Type': 'application/json' };

export async function getAppSettings(): Promise<AppSettings> {
  const response = await fetch(API.SETTINGS.APP, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Failed to fetch app settings: ${response.statusText}`);
  }
  return response.json();
}

export async function updateAppSettings(body: Partial<AppSettings>): Promise<AppSettings> {
  const response = await fetch(API.SETTINGS.APP, {
    method: 'PUT',
    headers: JSON_HEADERS,
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to save app settings: ${text}`);
  }
  return response.json();
}
