import { API } from '../config/api';

export interface WebhookConfig {
  name: string;
  url: string;
  enabled: boolean;
}

export interface ReportConfig {
  id: string;
  org_id: string;
  enabled: boolean;
  schedule_type: 'daily' | 'weekly' | 'monthly';
  send_empty_report: boolean;
  empty_message: string | null;
  send_detailed_report: boolean;
  email_recipients: string[];
  slack_webhooks: WebhookConfig[];
  teams_webhooks: WebhookConfig[];
  googlechat_webhooks: WebhookConfig[];
  created_at: string;
  updated_at: string;
}

export interface ReportHistory {
  id: string;
  org_id: string | null;
  report_config_id: string | null;
  report_type: string;
  period_start: string | null;
  period_end: string | null;
  generated_at: string;
  total_backups: number;
  successful_backups: number;
  failed_backups: number;
  success_rate: string | null;
  coverage_rate: string | null;
  is_empty: boolean;
  delivery_status: Record<string, string> | null;
  error_message: string | null;
  created_at: string;
}

export interface ReportConfigCreate {
  enabled: boolean;
  schedule_type: string;
  send_empty_report: boolean;
  empty_message?: string | null;
  send_detailed_report?: boolean;
  email_recipients: string[];
  slack_webhooks: WebhookConfig[];
  teams_webhooks: WebhookConfig[];
  googlechat_webhooks: WebhookConfig[];
}

export interface ReportConfigUpdate {
  enabled?: boolean;
  schedule_type?: string;
  send_empty_report?: boolean;
  empty_message?: string | null;
  send_detailed_report?: boolean;
  email_recipients?: string[];
  slack_webhooks?: WebhookConfig[];
  teams_webhooks?: WebhookConfig[];
  googlechat_webhooks?: WebhookConfig[];
}

const JSON_HEADERS: Record<string, string> = { 'Content-Type': 'application/json' };

class ReportService {
  async getConfig(): Promise<ReportConfig> {
    const response = await fetch(API.REPORTS.CONFIG);
    if (!response.ok) {
      throw new Error(`Failed to fetch report config: ${response.statusText}`);
    }
    return response.json();
  }

  async createConfig(config: ReportConfigCreate): Promise<ReportConfig> {
    const response = await fetch(API.REPORTS.CONFIG, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(config),
    });
    if (!response.ok) {
      throw new Error(`Failed to create report config: ${response.statusText}`);
    }
    return response.json();
  }

  async updateConfig(config: ReportConfigUpdate): Promise<ReportConfig> {
    const response = await fetch(API.REPORTS.CONFIG, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify(config),
    });
    if (!response.ok) {
      throw new Error(`Failed to update report config: ${response.statusText}`);
    }
    return response.json();
  }

  async getHistory(limit: number = 50, offset: number = 0, reportType?: string): Promise<ReportHistory[]> {
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
      ...(reportType ? { report_type: reportType } : {}),
    });
    const response = await fetch(`${API.REPORTS.HISTORY}?${params}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch report history: ${response.statusText}`);
    }
    return response.json();
  }

  async sendReport(reportType: 'DAILY' | 'WEEKLY' | 'MONTHLY'): Promise<{ success: boolean; report_id: string | null; message: string }> {
    const response = await fetch(API.REPORTS.SEND, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ report_type: reportType }),
    });
    if (!response.ok) {
      throw new Error(`Failed to send report: ${response.statusText}`);
    }
    return response.json();
  }

  async getHistoryDetail(reportId: string): Promise<ReportHistory> {
    const response = await fetch(API.REPORTS.HISTORY_DETAIL(reportId));
    if (!response.ok) {
      throw new Error(`Failed to fetch report history detail: ${response.statusText}`);
    }
    return response.json();
  }
}

export const reportService = new ReportService();
