import { useState, useCallback, useEffect, useRef } from 'react';
import { getApiBaseUrl } from '../utils/apiConfig';

type NetworkStatus = 'checking' | 'online' | 'offline';

const DEFAULT_API_BASE = getApiBaseUrl();

export const useNetworkStatus = () => {
  const [status, setStatus] = useState<NetworkStatus>('checking');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkNetwork = useCallback(async () => {
    setStatus('checking');
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${DEFAULT_API_BASE.replace(/\/$/, '')}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      setStatus(response.ok ? 'online' : 'offline');
    } catch {
      setStatus('offline');
    }
  }, []);

  const startPolling = useCallback(() => {
    checkNetwork();
    intervalRef.current = setInterval(checkNetwork, 15000);
  }, [checkNetwork]);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return { status, checkNetwork, startPolling, stopPolling };
};
