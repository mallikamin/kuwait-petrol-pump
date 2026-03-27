export type UserRole = 'admin' | 'manager' | 'cashier' | 'operator' | 'accountant';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export interface Branch {
  id: string;
  name: string;
  code: string;
  location?: string;
  isActive: boolean;
}

export interface FuelType {
  id: string;
  code: string;
  name: string;
}

export interface FuelPrice {
  id: string;
  fuelType: FuelType;
  pricePerLiter: string;
  effectiveFrom: string;
}

export interface DispensingUnit {
  id: string;
  unitNumber: number;
  name: string;
  branchId: string;
  isActive: boolean;
}

export interface Nozzle {
  id: string;
  nozzleNumber: number;
  dispensingUnit: DispensingUnit;
  fuelType: FuelType;
  isActive: boolean;
  currentPrice?: string;
}

export interface Shift {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
}

export interface ShiftInstance {
  id: string;
  shift: Shift;
  branch: Branch;
  openedBy: User;
  closedBy?: User;
  openedAt: string;
  closedAt?: string;
  status: 'open' | 'closed';
  notes?: string;
}

export interface MeterReading {
  id: string;
  nozzle: Nozzle;
  shiftInstance: ShiftInstance;
  readingType: 'opening' | 'closing';
  meterValue: string;
  imageUrl?: string;
  ocrResult?: string;
  isManualOverride: boolean;
  recordedBy: User;
  recordedAt: string;
}

export type PaymentMethod = 'cash' | 'credit' | 'card' | 'pso_card';

export interface FuelSale {
  id: string;
  saleNumber: string;
  branch: Branch;
  shiftInstance?: ShiftInstance;
  nozzle: Nozzle;
  fuelType: FuelType;
  quantityLiters: string;
  pricePerLiter: string;
  totalAmount: string;
  paymentMethod: PaymentMethod;
  vehicleNumber?: string;
  slipNumber?: string;
  customer?: Customer;
  createdBy: User;
  createdAt: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  barcode?: string;
  unitPrice: string;
  costPrice?: string;
  lowStockThreshold?: number;
  isActive: boolean;
}

export interface NonFuelSaleItem {
  id: string;
  product: Product;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
}

export interface NonFuelSale {
  id: string;
  saleNumber: string;
  branch: Branch;
  shiftInstance?: ShiftInstance;
  items: NonFuelSaleItem[];
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  totalAmount: string;
  paymentMethod: PaymentMethod;
  customer?: Customer;
  createdBy: User;
  createdAt: string;
}

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  vehicleNumbers?: string[];
  creditLimit?: string;
  creditDays?: number;
  isActive: boolean;
  createdAt: string;
}

export interface StockLevel {
  id: string;
  product: Product;
  branch: Branch;
  quantity: number;
  isLowStock: boolean;
  lastUpdated: string;
}

export interface Bifurcation {
  id: string;
  branch: Branch;
  date: string;
  shiftInstance?: ShiftInstance;
  pmgTotalLiters: string;
  pmgTotalAmount: string;
  hsdTotalLiters: string;
  hsdTotalAmount: string;
  cashAmount: string;
  creditAmount: string;
  cardAmount: string;
  psoCardAmount: string;
  expectedTotal: string;
  actualTotal: string;
  variance: string;
  varianceNotes?: string;
  status: 'pending' | 'verified';
  createdBy: User;
  verifiedBy?: User;
  createdAt: string;
  verifiedAt?: string;
}

export interface SalesSummary {
  totalSales: number;
  totalAmount: string;
  fuelSales: {
    totalLiters: string;
    totalAmount: string;
  };
  nonFuelSales: {
    totalItems: number;
    totalAmount: string;
  };
  paymentBreakdown: Array<{
    method: PaymentMethod;
    count: number;
    amount: string;
  }>;
}

export interface PaginationParams {
  limit?: number;
  offset?: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    pages: number;
  };
}
