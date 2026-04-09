const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080/api/v1';

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
  private baseUrl = API_URL;

  async getMicrosoftLoginUrl(): Promise<MicrosoftAuthUrlResponse> {
    const res = await fetch(`${this.baseUrl}/auth/microsoft/url`);
    if (!res.ok) throw new Error(`Failed to get login URL: ${res.statusText}`);
    return res.json();
  }

  async handleOAuthCallback(code: string, state?: string): Promise<LoginResponse> {
    const res = await fetch(`${this.baseUrl}/auth/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, state }),
    });
    if (!res.ok) throw new Error(`OAuth callback failed: ${res.statusText}`);
    const data = await res.json();
    this.storeTokens(data);
    return data;
  }

  async refreshToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const res = await fetch(`${this.baseUrl}/auth/refresh`, {
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
      await fetch(`${this.baseUrl}/auth/logout`, {
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
    const res = await fetch(`${this.baseUrl}/auth/me`, {
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
