import { format as dateFnsFormat } from 'date-fns';

export function formatCurrency(amount: string | number): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export function formatNumber(value: string | number, decimals: number = 2): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return num.toFixed(decimals);
}

export function formatDate(date: string | Date): string {
  return dateFnsFormat(new Date(date), 'MMM dd, yyyy');
}

export function formatDateTime(date: string | Date): string {
  return dateFnsFormat(new Date(date), 'MMM dd, yyyy HH:mm');
}

export function formatTime(date: string | Date): string {
  return dateFnsFormat(new Date(date), 'HH:mm:ss');
}

export function getPaymentMethodLabel(method: string): string {
  const labels: Record<string, string> = {
    cash: 'Cash',
    credit: 'Credit',
    card: 'Card',
    pso_card: 'PSO Card',
  };
  return labels[method] || method;
}

export function getRoleLabel(role: string): string {
  const labels: Record<string, string> = {
    admin: 'Administrator',
    manager: 'Manager',
    cashier: 'Cashier',
    operator: 'Operator',
    accountant: 'Accountant',
  };
  return labels[role] || role;
}
