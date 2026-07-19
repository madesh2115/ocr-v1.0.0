/** Format a money value for display, e.g. "92.00" → "₹92.00" or "USD 92.00" */
export function formatMoney(value: string | number | null | undefined, currency = 'INR'): string {
  if (value == null || value === '') return '—';
  const num = typeof value === 'number' ? value : parseFloat(String(value).replace(/,/g, ''));
  if (isNaN(num)) return '—';

  if (currency === 'INR') return `₹${num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (currency === 'USD') return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${currency} ${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Format a date string for display, e.g. "2026-07-02" → "02 Jul 2026" */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Not detected';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return dateStr; }
}

/** Format a time string for display, e.g. "14:30" → "2:30 PM" */
export function formatTime(timeStr: string | null | undefined): string {
  if (!timeStr) return '';
  try {
    const [h, m] = timeStr.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    return `${hour12}:${m.toString().padStart(2, '0')} ${ampm}`;
  } catch { return timeStr; }
}

/** Display null/undefined as a placeholder string */
export function displayValue(value: string | number | null | undefined, placeholder = 'Not detected'): string {
  if (value == null || value === '') return placeholder;
  return String(value);
}

/** Get confidence level label and color */
export function confidenceInfo(confidence: number | null | undefined): { label: string; color: string } {
  if (confidence == null) return { label: 'Unknown', color: '#94A3B8' };
  if (confidence >= 0.85) return { label: 'High', color: '#059669' };
  if (confidence >= 0.65) return { label: 'Medium', color: '#D97706' };
  return { label: 'Low', color: '#DC2626' };
}

/** Format confidence as percentage string */
export function confidencePercent(confidence: number | null | undefined): string {
  if (confidence == null) return '—';
  return `${Math.round(confidence * 100)}%`;
}

/** Map database review_status to display label */
export function reviewStatusLabel(status: string | null | undefined): string {
  const map: Record<string, string> = {
    unreviewed: 'Needs Review',
    needs_review: 'Needs Review',
    reviewed: 'Reviewed',
    corrected: 'Corrected',
    approved: 'Approved',
  };
  return map[status || ''] || 'Unknown';
}
