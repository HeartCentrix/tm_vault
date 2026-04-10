/**
 * Alerts Service - Fetch and manage backup alerts
 */
import { API } from '../config/api';

export interface AlertItem {
  id: string;
  severity: string;
  title: string;
  description: string;
  status: 'ACTIVE' | 'RESOLVED';
  createdAt: string;
  resolved?: boolean;
  tenantId?: string;
  type?: string;
  message?: string;
  resourceType?: string;
  resourceName?: string;
}

export interface AlertListResponse {
  content: AlertItem[];
  totalPages: number;
  totalElements: number;
  size: number;
  number: number;
}

export interface NotificationSettings {
  emailEnabled: boolean;
  slackEnabled: boolean;
  teamsEnabled: boolean;
  alertThresholds: {
    critical: boolean;
    high: boolean;
    medium: boolean;
    low: boolean;
  };
}

export interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  createdAt: string;
}

const getAuthHeaders = (): Record<string, string> => {
  const token = localStorage.getItem('access_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const AlertService = {
  async listAlerts(
    page = 1,
    size = 50,
    options?: { unresolvedOnly?: boolean; tenantId?: string }
  ): Promise<AlertListResponse> {
    let url = `${API.ALERTS.LIST}?page=${page}&size=${size}`;
    if (options?.unresolvedOnly) url += '&unresolved=true';
    if (options?.tenantId) url += `&tenantId=${options.tenantId}`;

    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch alerts');
    return res.json();
  },

  async getAlert(alertId: string): Promise<AlertItem> {
    const url = `${API.ALERTS.LIST}/${alertId}`;
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch alert');
    return res.json();
  },

  async resolveAlert(alertId: string): Promise<void> {
    const url = API.ALERTS.RESOLVE(alertId);
    const res = await fetch(url, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to resolve alert');
  },

  async getNotificationSettings(): Promise<NotificationSettings> {
    const url = `${API.ALERTS.LIST}/notifications/settings`;
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch notification settings');
    return res.json();
  },

  async updateNotificationSettings(settings: Partial<NotificationSettings>): Promise<void> {
    const url = `${API.ALERTS.LIST}/notifications/settings`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (!res.ok) throw new Error('Failed to update notification settings');
  },

  async listWebhooks(): Promise<WebhookConfig[]> {
    const url = `${API.ALERTS.LIST}/webhooks`;
    const res = await fetch(url, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch webhooks');
    return res.json();
  },

  async createWebhook(webhook: { name: string; url: string; enabled: boolean }): Promise<WebhookConfig> {
    const res = await fetch(`${API.ALERTS.LIST}/webhooks`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(webhook),
    });
    if (!res.ok) throw new Error('Failed to create webhook');
    return res.json();
  },

  async deleteWebhook(webhookId: string): Promise<void> {
    const url = `${API.ALERTS.LIST}/webhooks/${webhookId}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to delete webhook');
  },

  async testWebhook(webhookId: string): Promise<{ success: boolean; message: string }> {
    const url = `${API.ALERTS.LIST}/webhooks/${webhookId}/test`;
    const res = await fetch(url, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to test webhook');
    return res.json();
  },
};
