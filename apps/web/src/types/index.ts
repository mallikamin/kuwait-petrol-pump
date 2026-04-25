export type UserRole = 'admin' | 'manager' | 'cashier' | 'auditor' | 'accountant' | 'operator';

export interface User {
  id: string;
  username: string;
  email: string;
  full_name: string;
  role: UserRole;
  branch_id?: string;
  is_active: boolean;
  created_at: string;
  branch?: { id: string; name: string; code?: string | null } | null;
  organization?: UserOrganization | null;
}

export interface UserOrganization {
  id: string;
  name: string;
  code: string | null;
  currency: string;
  timezone: string;
  isDemo: boolean;
  companyName: string | null;
  companyAddress: string | null;
  reportFooter: string | null;
}

export interface Branch {
  id: string;
  name: string;
  code: string;
  address: string;
  city: string;
  phone: string;
  is_active: boolean;
  created_at: string;
}

export interface DispensingUnit {
  id: string;
  branchId: string;
  unitNumber: number;
  name?: string;
  isActive: boolean;
  createdAt: string;
  nozzles: Nozzle[];
}

export interface Nozzle {
  id: string;
  dispensingUnitId: string;
  nozzleNumber: number;
  name?: string;
  fuelTypeId: string;
  fuelType?: FuelType;
  dispensingUnit?: { id: string; unitNumber: number; name?: string };
  meterType: string;
  isActive: boolean;
  createdAt: string;
}

export interface FuelType {
  id: string;
  name: string;
  code: string;
  unit: string;
  createdAt: string;
}

export interface FuelPriceWithType {
  id: string;
  fuelTypeId: string;
  pricePerLiter: number;
  effectiveFrom: string;
  effectiveTo?: string;
  fuelType?: FuelType;
}

export interface FuelPrice {
  id: string;
  fuelTypeId: string;
  fuelType?: FuelType;
  pricePerLiter: number;
  effectiveFrom: string;
  effectiveTo?: string;
  changedBy?: string;
  notes?: string;
  createdAt: string;
}

// Shift Template (from shifts table - defines shift schedules)
export interface ShiftTemplate {
  id: string;
  branchId: string;
  shiftNumber: number;
  name: string;
  startTime: string; // ISO datetime string
  endTime: string; // ISO datetime string
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// Shift Instance (from shift_instances table - actual shift occurrences)
export interface Shift {
  id: string;
  branch_id: string;
  branch?: Branch;
  shift_number: string;
  user_id: string;
  user?: User;
  start_time: string;
  end_time?: string;
  opening_cash: number;
  closing_cash?: number;
  status: 'open' | 'closed';
  created_at: string;
}

export interface MeterReading {
  id: string;
  shift_id: string;
  nozzle_id: string;
  nozzle?: Nozzle;
  reading_type: 'opening' | 'closing';
  reading_value: number;
  image_url?: string;
  ocr_value?: number;
  ocr_confidence?: number;
  is_verified: boolean;
  created_at: string;
}

export interface Sale {
  id: string;
  shift_id: string;
  shift?: Shift;
  sale_type: 'fuel' | 'product';
  customer_id?: string;
  customer?: Customer;
  payment_method: 'cash' | 'card' | 'credit';
  total_amount: number;
  tax_amount: number;
  discount_amount: number;
  net_amount: number;
  status: 'completed' | 'pending' | 'cancelled';
  created_at: string;
  items: SaleItem[];
}

export interface SaleItem {
  id: string;
  sale_id: string;
  item_type: 'fuel' | 'product';
  nozzle_id?: string;
  nozzle?: Nozzle;
  product_id?: string;
  product?: Product;
  quantity: number;
  unit_price: number;
  total_price: number;
  created_at: string;
}

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  vehicleNumbers?: string[];
  creditLimit?: number;
  creditDays?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  barcode?: string | null;
  category?: string | null;
  unitPrice: number;
  costPrice?: number | null;
  isActive: boolean;
  lowStockThreshold?: number | null;
  createdAt: string;
  updatedAt: string;
  stockLevels?: Stock[];
}

export interface Category {
  id: string;
  name: string;
  code: string;
  description?: string;
  is_active: boolean;
  created_at: string;
}

export interface Stock {
  id: string;
  product_id: string;
  product?: Product;
  branch_id: string;
  branch?: Branch;
  quantity: number;
  last_updated: string;
}

export interface Bifurcation {
  id: string;
  shift_id: string;
  shift?: Shift;
  total_sales: number;
  cash_sales: number;
  card_sales: number;
  credit_sales: number;
  physical_cash: number;
  variance: number;
  variance_percentage: number;
  status: 'pending' | 'verified' | 'rejected';
  notes?: string;
  verified_by?: string;
  verified_at?: string;
  created_at: string;
}

export interface LedgerEntry {
  id: string;
  customer_id: string;
  reference_type: 'sale' | 'payment' | 'adjustment';
  reference_id: string;
  debit: number;
  credit: number;
  balance: number;
  description: string;
  created_at: string;
}

export interface DashboardStats {
  today_sales: number;
  today_fuel_sales: number;
  today_product_sales: number;
  active_shifts: number;
  pending_bifurcations: number;
  low_stock_products: number;
  total_customers: number;
  pending_credit: number;
}

export interface SalesChart {
  hour: string;
  fuel: number;
  products: number;
  total: number;
}

export interface PaymentMethodStats {
  method: string;
  amount: number;
  count: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
  pages: number;
}

export interface ApiError {
  detail: string;
  status?: number;
}
