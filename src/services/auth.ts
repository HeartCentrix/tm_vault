import { API } from '../config/api';

export interface User {
  id: string;
  email: string;
  name: string;
  roles: string[];
  organizationId: string;
  tenantId?: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: User;
}

export interface MicrosoftAuthUrlResponse {
  url: string;
  state: string;
}

class AuthService {
  async getMicrosoftLoginUrl(): Promise<MicrosoftAuthUrlResponse> {
    const res = await fetch(API.AUTH.LOGIN_URL);
    if (!res.ok) throw new Error(`Failed to get login URL: ${res.statusText}`);
    return res.json();
  }

  async getDatasourceUrl(): Promise<MicrosoftAuthUrlResponse> {
    const res = await fetch(API.AUTH.DATASOURCE_URL);
    if (!res.ok) throw new Error(`Failed to get datasource URL: ${res.statusText}`);
    return res.json();
  }

  async getAzureDatasourceUrl(): Promise<MicrosoftAuthUrlResponse> {
    const res = await fetch(API.AUTH.AZURE_DATASOURCE_URL);
    if (!res.ok) throw new Error(`Failed to get Azure datasource URL: ${res.statusText}`);
    return res.json();
  }

  async handleOAuthCallback(code: string, state?: string): Promise<LoginResponse> {
    const res = await fetch(API.AUTH.CALLBACK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, state }),
    });
    if (!res.ok) throw new Error(`OAuth callback failed: ${res.statusText}`);
    const data = await res.json();
    this.storeTokens(data);
    return data;
  }

  async handleDatasourceCallback(code: string, state?: string): Promise<any> {
    const token = this.getToken();
    if (!token) throw new Error('Not authenticated');
    const res = await fetch(API.AUTH.DATASOURCE_CALLBACK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code, state }),
    });
    if (!res.ok) throw new Error(`Datasource callback failed: ${res.statusText}`);
    return res.json();
  }

  async handleDatasourceConsentCallback(externalTenantId: string, state?: string): Promise<any> {
    const token = this.getToken();
    if (!token) throw new Error('Not authenticated');
    const res = await fetch(API.AUTH.DATASOURCE_CALLBACK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        external_tenant_id: externalTenantId,
        admin_consent: true,
        state: state || '',
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Datasource consent callback failed: ${res.status} ${errText}`);
    }
    return res.json();
  }

  async handleAzureDatasourceCallback(code: string, state?: string): Promise<any> {
    const token = this.getToken();
    if (!token) throw new Error('Not authenticated');
    const res = await fetch(API.AUTH.AZURE_DATASOURCE_CALLBACK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code, state }),
    });
    if (!res.ok) throw new Error(`Azure datasource callback failed: ${res.statusText}`);
    return res.json();
  }

  async refreshToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const res = await fetch(API.AUTH.REFRESH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) throw new Error(`Token refresh failed: ${res.statusText}`);
    const data = await res.json();
    this.storeTokens(data);
    return data;
  }

  async logout(): Promise<void> {
    const refreshToken = this.getRefreshToken();
    try {
      await fetch(API.AUTH.LOGOUT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // Ignore logout failures
    }
    this.clearTokens();
  }

  async getCurrentUser(): Promise<User> {
    const token = this.getToken();
    if (!token) throw new Error('Not authenticated');
    const res = await fetch(API.AUTH.ME, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Failed to get user: ${res.statusText}`);
    const user = await res.json();
    this.storeUser(user);
    return user;
  }

  storeTokens(data: { accessToken: string; refreshToken: string }): void {
    localStorage.setItem('access_token', data.accessToken);
    localStorage.setItem('refresh_token', data.refreshToken);
  }

  storeUser(user: User): void {
    localStorage.setItem('user', JSON.stringify(user));
  }

  getToken(): string | null {
    return localStorage.getItem('access_token');
  }

  getRefreshToken(): string | null {
    return localStorage.getItem('refresh_token');
  }

  getCurrentUserStored(): User | null {
    const u = localStorage.getItem('user');
    return u ? JSON.parse(u) : null;
  }

  clearTokens(): void {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
  }

  isAuthenticated(): boolean {
    return !!this.getToken();
  }
}

export const authService = new AuthService();
