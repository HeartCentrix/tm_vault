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

export interface AdminConsentStatus {
  id: string;
  consentType: string;
  grantedBy?: string;
  consentedAt?: string;
  lastUsedAt?: string;
  isActive: boolean;
  scope?: string;
}

type RawAdminConsentStatus = AdminConsentStatus & {
  consent_type?: string;
  granted_by?: string;
  consented_at?: string;
  last_used_at?: string;
  is_active?: boolean;
};

export interface AdminConsentResponse {
  message: string;
  tenantId: string;
  consentType: string;
  consentedAt: string;
}

export interface PowerBIReadinessCheck {
  key: string;
  label: string;
  status: 'ready' | 'warning' | 'action_required';
  detail: string;
}

export interface PowerBIReadiness {
  tenantId: string;
  status: 'ready' | 'warning' | 'action_required';
  summary: string;
  authMode: string;
  usesDedicatedApp: boolean;
  accessibleWorkspaceCount: number;
  discoveredWorkspaceCount: number;
  checks: PowerBIReadinessCheck[];
  recommendedActions: string[];
}

class AuthService {
  private normalizeAdminConsentStatus(data: RawAdminConsentStatus | null): AdminConsentStatus | null {
    if (!data) return null;
    return {
      id: data.id,
      consentType: data.consentType ?? data.consent_type ?? '',
      grantedBy: data.grantedBy ?? data.granted_by,
      consentedAt: data.consentedAt ?? data.consented_at,
      lastUsedAt: data.lastUsedAt ?? data.last_used_at,
      isActive: data.isActive ?? data.is_active ?? false,
      scope: data.scope,
    };
  }

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

  async getPowerBIConnectUrl(tenantId: string): Promise<MicrosoftAuthUrlResponse> {
    const res = await fetch(API.AUTH.POWER_BI_URL(tenantId));
    if (!res.ok) throw new Error(`Failed to get Power BI connect URL: ${res.statusText}`);
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
    const res = await fetch(API.AUTH.DATASOURCE_CALLBACK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, state }),
    });
    if (!res.ok) throw new Error(`Datasource callback failed: ${res.statusText}`);
    return res.json();
  }

  async handleDatasourceConsentCallback(externalTenantId: string, state?: string): Promise<any> {
    const res = await fetch(API.AUTH.DATASOURCE_CALLBACK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    const res = await fetch(API.AUTH.AZURE_DATASOURCE_CALLBACK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, state }),
    });
    if (!res.ok) throw new Error(`Azure datasource callback failed: ${res.statusText}`);
    return res.json();
  }

  async handlePowerBICallback(tenantId: string, code: string, state?: string): Promise<any> {
    const res = await fetch(API.AUTH.POWER_BI_CALLBACK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, code, state }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Power BI callback failed: ${res.status} ${errText}`);
    }
    return res.json();
  }

  async refreshToken(_refreshToken?: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    // The refresh token rides in an HttpOnly cookie now; the body is empty.
    const res = await fetch(API.AUTH.REFRESH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) throw new Error(`Token refresh failed: ${res.statusText}`);
    return res.json();
  }

  async logout(): Promise<void> {
    try {
      await fetch(API.AUTH.LOGOUT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      // Ignore logout failures — clearing the breadcrumb below is what the UI cares about.
    }
    this.clearTokens();
  }

  async getCurrentUser(): Promise<User> {
    const res = await fetch(API.AUTH.ME);
    if (!res.ok) throw new Error(`Failed to get user: ${res.statusText}`);
    const user = await res.json();
    this.storeUser(user);
    return user;
  }

  // Tokens live in HttpOnly cookies set by the backend — JS never sees them
  // (XSS can no longer steal the access token from localStorage). The cookies
  // travel automatically with every fetch() because main.tsx patches fetch
  // to default `credentials: 'include'`. The methods below remain for
  // backward compatibility with existing call sites; getToken returns null
  // and the gateway picks the cookie up instead of the (junk) Bearer header.
  storeTokens(_data: { accessToken: string; refreshToken: string }): void {
    // No-op: backend Set-Cookie does the storage. Kept so existing callers
    // that invoke this after handleOAuthCallback() / refreshToken() build.
  }

  storeUser(user: User): void {
    localStorage.setItem('user', JSON.stringify(user));
  }

  getToken(): string | null {
    return null;
  }

  getRefreshToken(): string | null {
    return null;
  }

  getCurrentUserStored(): User | null {
    const u = localStorage.getItem('user');
    return u ? JSON.parse(u) : null;
  }

  clearTokens(): void {
    // Legacy keys that may still be present from a pre-cookie session.
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
  }

  isAuthenticated(): boolean {
    // The cookie is HttpOnly, so we can't read it directly. Use the user
    // breadcrumb as a UX hint — actual auth is enforced by the backend on
    // every request, and a stale breadcrumb just produces a 401 that the
    // app handles by redirecting to /signin.
    return !!localStorage.getItem('user');
  }

  // ============ Admin Consent Methods ============
  // Uses existing datasource APIs for URL generation and callbacks

  async getM365AdminConsentUrl(): Promise<MicrosoftAuthUrlResponse> {
    const res = await fetch(API.AUTH.DATASOURCE_URL);
    if (!res.ok) throw new Error(`Failed to get M365 admin consent URL: ${res.statusText}`);
    return res.json();
  }

  async getAzureAdminConsentUrl(): Promise<MicrosoftAuthUrlResponse> {
    const res = await fetch(API.AUTH.AZURE_DATASOURCE_URL);
    if (!res.ok) throw new Error(`Failed to get Azure admin consent URL: ${res.statusText}`);
    return res.json();
  }

  async handleM365AdminConsentCallback(externalTenantId: string, state?: string): Promise<any> {
    const res = await fetch(API.AUTH.DATASOURCE_CALLBACK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        external_tenant_id: externalTenantId,
        admin_consent: true,
        state: state || '',
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`M365 admin consent callback failed: ${res.status} ${errText}`);
    }
    return res.json();
  }

  async handleAzureAdminConsentCallback(code: string, state?: string): Promise<any> {
    const res = await fetch(API.AUTH.AZURE_DATASOURCE_CALLBACK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, state }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Azure admin consent callback failed: ${res.status} ${errText}`);
    }
    return res.json();
  }

  async getM365AdminConsentStatus(): Promise<AdminConsentStatus | null> {
    const res = await fetch(API.ADMIN_CONSENT.M365_STATUS);
    if (!res.ok) throw new Error(`Failed to get M365 admin consent status: ${res.statusText}`);
    const data = await res.json();
    return this.normalizeAdminConsentStatus(data);
  }

  async getAzureAdminConsentStatus(): Promise<AdminConsentStatus | null> {
    const res = await fetch(API.ADMIN_CONSENT.AZURE_STATUS);
    if (!res.ok) throw new Error(`Failed to get Azure admin consent status: ${res.statusText}`);
    const data = await res.json();
    return this.normalizeAdminConsentStatus(data);
  }

  async getPowerBIReadiness(tenantId: string): Promise<PowerBIReadiness> {
    const res = await fetch(API.ADMIN_CONSENT.POWER_BI_READINESS(tenantId));
    if (!res.ok) throw new Error(`Failed to get Power BI readiness: ${res.statusText}`);
    return res.json();
  }
}

export const authService = new AuthService();
