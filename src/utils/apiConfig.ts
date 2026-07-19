/**
 * Shared API base URL resolution.
 *
 * Resolution order:
 * 1. `apiBaseUrl` from app.json extra config  (production / custom server)
 * 2. Expo `hostUri` (development on physical phone over LAN)
 * 3. Fallback http://127.0.0.1:5000  (emulator / localhost dev)
 */
import Constants from 'expo-constants';

export function getApiBaseUrl(): string {
  const extra = Constants.expoConfig?.extra;
  if (extra?.apiBaseUrl) {
    return String(extra.apiBaseUrl).replace(/\/$/, '');
  }
  const expoHostUri = (Constants.expoConfig as { hostUri?: string } | null)?.hostUri;
  const expoHost = expoHostUri?.split(':')[0];
  if (expoHost) {
    return `http://${expoHost}:5000`;
  }
  return 'http://127.0.0.1:5000';
}
