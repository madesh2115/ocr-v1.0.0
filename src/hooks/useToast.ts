import { useCallback, useContext } from 'react';
import { ToastContext } from '../context/ToastContext';

export const useToast = () => {
  const { showToast } = useContext(ToastContext);
  return useCallback(showToast, [showToast]);
};
