import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';
import { getApiBaseUrl } from '../utils/apiConfig';

// ── Types ─────────────────────────────────────────────────────────────────────

export type User = {
  id: number;
  email: string;
  full_name: string;
  subscription_tier?: string;
  // add other user fields as needed
};

export type AuthResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: User;
};

export type RefreshResponse = {
  access_token: string;
  expires_in: number;
};

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (fullName: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<boolean>;
  updateProfile: (data: Partial<User>) => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | null>(null);

// ── Constants ─────────────────────────────────────────────────────────────────

const ACCESS_TOKEN_KEY = 'auth_access_token';
const REFRESH_TOKEN_KEY = 'auth_refresh_token';
const USER_KEY = 'auth_user';

const API_BASE = getApiBaseUrl();

// ── Auth Provider ─────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);

  // ── Token Storage Helpers ───────────────────────────────────────────────────

  const saveTokens = useCallback(async (access: string, refresh: string, userData: User) => {
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, access);
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refresh);
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(userData));
    setAccessToken(access);
    setRefreshToken(refresh);
    setUser(userData);
  }, []);

  const clearTokens = useCallback(async () => {
    await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
    setAccessToken(null);
    setRefreshToken(null);
    setUser(null);
  }, []);

  const loadStoredAuth = useCallback(async (): Promise<boolean> => {
    try {
      const storedAccess = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
      const storedRefresh = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
      const storedUser = await SecureStore.getItemAsync(USER_KEY);

      if (storedAccess && storedRefresh && storedUser) {
        setAccessToken(storedAccess);
        setRefreshToken(storedRefresh);
        setUser(JSON.parse(storedUser));

        // Validate token with GET /auth/me
        const response = await fetch(`${API_BASE}/auth/me`, {
          headers: {
            Authorization: `Bearer ${storedAccess}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          if (data.user) {
            setUser(data.user);
            await SecureStore.setItemAsync(USER_KEY, JSON.stringify(data.user));
          }
          return true;
        } else if (response.status === 401) {
          // Token expired, try refresh
          const refreshed = await refreshTokenWithStored();
          return refreshed;
        }
      }
      return false;
    } catch (error) {
      console.error('Error loading stored auth:', error);
      return false;
    }
  }, []);

  // ── Refresh token with stored refresh token ──────────────────────────────────

  const refreshTokenWithStored = async (): Promise<boolean> => {
    try {
      const storedRefresh = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
      if (!storedRefresh) return false;

      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ refresh_token: storedRefresh }),
      });

      if (response.ok) {
        const data: RefreshResponse = await response.json();
        const storedAccess = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
        const storedUser = await SecureStore.getItemAsync(USER_KEY);

        if (storedAccess && storedUser) {
          await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, data.access_token);
          setAccessToken(data.access_token);
          return true;
        }
      }
      await clearTokens();
      return false;
    } catch (error) {
      console.error('Error refreshing token:', error);
      return false;
    }
  };

  // ── Auth Methods ────────────────────────────────────────────────────────────

  const login = useCallback(async (email: string, password: string): Promise<void> => {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Login failed' }));
      throw new Error(error.message || 'Login failed');
    }

    const data: AuthResponse = await response.json();
    await saveTokens(data.access_token, data.refresh_token, data.user);
  }, [saveTokens]);

  const register = useCallback(async (fullName: string, email: string, password: string): Promise<void> => {
    const response = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ full_name: fullName, email, password }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Registration failed' }));
      throw new Error(error.message || 'Registration failed');
    }

    const data: AuthResponse = await response.json();
    await saveTokens(data.access_token, data.refresh_token, data.user);
  }, [saveTokens]);

  const logout = useCallback(async (): Promise<void> => {
    try {
      if (accessToken) {
        await fetch(`${API_BASE}/auth/logout`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
      }
    } catch (error) {
      console.error('Logout API error:', error);
    } finally {
      await clearTokens();
    }
  }, [accessToken, clearTokens]);

  const refreshTokenFn = useCallback(async (): Promise<boolean> => {
    return refreshTokenWithStored();
  }, []);

  const updateProfile = useCallback(async (data: Partial<User>): Promise<void> => {
    if (!accessToken) throw new Error('Not authenticated');

    const response = await fetch(`${API_BASE}/auth/update-profile`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Update failed' }));
      throw new Error(error.message || 'Update failed');
    }

    const result = await response.json();
    if (result.user) {
      setUser(result.user);
      await SecureStore.setItemAsync(USER_KEY, JSON.stringify(result.user));
    }
  }, [accessToken]);

  // ── Initialize on mount ─────────────────────────────────────────────────────

  useEffect(() => {
    const init = async () => {
      await loadStoredAuth();
      setIsLoading(false);
    };
    init();
  }, [loadStoredAuth]);

  // ── Expose context ───────────────────────────────────────────────────────────

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated: !!user && !!accessToken,
    token: accessToken,
    login,
    register,
    logout,
    refreshToken: refreshTokenFn,
    updateProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// ── API Helper ───────────────────────────────────────────────────────────────

export async function authFetch(
  endpoint: string,
  options: RequestInit = {},
  refreshTokenFn?: () => Promise<boolean>
): Promise<Response> {
  const accessToken = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  let response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  // Handle 401 by attempting token refresh
  if (response.status === 401 && refreshTokenFn) {
    const refreshed = await refreshTokenFn();
    if (refreshed) {
      const newToken = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
      headers['Authorization'] = `Bearer ${newToken}`;
      response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
      });
    }
  }

  return response;
}
