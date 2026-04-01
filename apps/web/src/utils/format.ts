import { format as dateFnsFormat } from 'date-fns';

export const formatCurrency = (amount: number): string => {
  // Format as PKR (Pakistani Rupees) with explicit "Rs" prefix
  const formatted = new Intl.NumberFormat('en-PK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `Rs ${formatted}`;
};

export const formatNumber = (value: number, decimals: number = 2): string => {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
};

export const formatDate = (date: string | Date, formatStr: string = 'PPP'): string => {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return dateFnsFormat(dateObj, formatStr);
};

export const formatDateTime = (date: string | Date): string => {
  return formatDate(date, 'PPP p');
};

export const formatTime = (date: string | Date): string => {
  return formatDate(date, 'p');
};

export const truncate = (str: string, length: number): string => {
  return str.length > length ? `${str.substring(0, length)}...` : str;
};
