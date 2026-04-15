import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

type GitHubUser = {
  login: string;
  name: string | null;
  avatarUrl: string;
  id: number;
};

type AuthState = {
  ready: boolean;
  user: GitHubUser | null;
  token: string | null;
  signIn: () => Promise<DeviceCode | null>;
  completeSignIn: (deviceCode: string, interval: number) => Promise<void>;
  signOut: () => Promise<void>;
};

type DeviceCode = {
  userCode: string;
  verificationUri: string;
  deviceCode: string;
  interval: number;
  expiresIn: number;
};

const TOKEN_KEY = 'github_access_token';

const AuthContext = createContext<AuthState | null>(null);

function getClientId(): string | null {
  const id = (Constants.expoConfig?.extra as any)?.githubClientId;
  if (!id || id.startsWith('REPLACE_')) return null;
  return id;
}

async function fetchUser(token: string): Promise<GitHubUser> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) throw new Error(`GitHub /user returned ${res.status}`);
  const data = await res.json();
  return {
    login: data.login,
    name: data.name,
    avatarUrl: data.avatar_url,
    id: data.id,
  };
}

// GitHub OAuth Device Flow — no client secret required, works great for mobile.
// https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow
async function requestDeviceCode(clientId: string): Promise<DeviceCode> {
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope: 'read:user repo' }),
  });
  if (!res.ok) throw new Error(`Device code request failed: ${res.status}`);
  const data = await res.json();
  return {
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    deviceCode: data.device_code,
    interval: data.interval ?? 5,
    expiresIn: data.expires_in,
  };
}

async function pollForToken(clientId: string, deviceCode: string, interval: number): Promise<string> {
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const deadline = Date.now() + 15 * 60 * 1000;
  let waitMs = interval * 1000;

  while (Date.now() < deadline) {
    await delay(waitMs);
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    const data = await res.json();
    if (data.access_token) return data.access_token as string;
    if (data.error === 'slow_down') waitMs += 5000;
    if (data.error === 'authorization_pending') continue;
    if (data.error === 'expired_token' || data.error === 'access_denied') {
      throw new Error(data.error_description ?? data.error);
    }
  }
  throw new Error('Device flow timed out');
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<GitHubUser | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const saved = await SecureStore.getItemAsync(TOKEN_KEY);
        if (saved) {
          setToken(saved);
          try {
            setUser(await fetchUser(saved));
          } catch {
            await SecureStore.deleteItemAsync(TOKEN_KEY);
            setToken(null);
          }
        }
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const signIn = async (): Promise<DeviceCode | null> => {
    const clientId = getClientId();
    if (!clientId) {
      throw new Error(
        'GitHub OAuth client ID not configured. Set githubClientId in app.json → expo.extra.'
      );
    }
    return requestDeviceCode(clientId);
  };

  const completeSignIn = async (deviceCode: string, interval: number) => {
    const clientId = getClientId();
    if (!clientId) throw new Error('Missing GitHub client ID.');
    const accessToken = await pollForToken(clientId, deviceCode, interval);
    await SecureStore.setItemAsync(TOKEN_KEY, accessToken);
    setToken(accessToken);
    setUser(await fetchUser(accessToken));
  };

  const signOut = async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    setToken(null);
    setUser(null);
  };

  const value = useMemo<AuthState>(
    () => ({ ready, user, token, signIn, completeSignIn, signOut }),
    [ready, user, token]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
