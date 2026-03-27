import apiClient from './client';
import type * as Types from '@shared/types';

// Auth endpoints
export const authApi = {
  login: (email: string, password: string) =>
    apiClient.post<Types.AuthResponse>('/auth/login', { email, password }),

  logout: () => apiClient.post('/auth/logout'),

  me: () => apiClient.get<Types.User>('/auth/me'),

  changePassword: (oldPassword: string, newPassword: string) =>
    apiClient.post('/auth/change-password', { oldPassword, newPassword }),
};

// Branches endpoints
export const branchesApi = {
  getAll: () => apiClient.get<Types.Branch[]>('/branches'),

  getById: (id: string) => apiClient.get<Types.Branch>(`/branches/${id}`),

  getDispensingUnits: (id: string) =>
    apiClient.get<Types.DispensingUnit[]>(`/branches/${id}/dispensing-units`),
};

// Fuel prices endpoints
export const fuelPricesApi = {
  getCurrent: () =>
    apiClient.get<{ prices: Types.FuelPrice[] }>('/fuel-prices/current'),

  getHistory: (params?: { startDate?: string; endDate?: string }) =>
    apiClient.get<Types.FuelPrice[]>('/fuel-prices/history', { params }),

  getFuelTypes: () => apiClient.get<Types.FuelType[]>('/fuel-prices/fuel-types'),

  updatePrice: (fuelTypeId: string, pricePerLiter: number) =>
    apiClient.post('/fuel-prices', { fuelTypeId, pricePerLiter }),
};

// Nozzles endpoints
export const nozzlesApi = {
  getAll: (params?: {
    branchId?: string;
    dispensingUnitId?: string;
    fuelTypeId?: string;
    isActive?: boolean;
  }) => apiClient.get<Types.Nozzle[]>('/nozzles', { params }),

  getById: (id: string) => apiClient.get<Types.Nozzle>(`/nozzles/${id}`),

  getLatestReading: (id: string) =>
    apiClient.get<Types.MeterReading>(`/nozzles/${id}/latest-reading`),

  updateStatus: (id: string, isActive: boolean) =>
    apiClient.patch(`/nozzles/${id}`, { isActive }),
};

// Shifts endpoints
export const shiftsApi = {
  open: (branchId: string, shiftId: string) =>
    apiClient.post<Types.ShiftInstance>('/shifts/open', { branchId, shiftId }),

  close: (id: string, notes?: string) =>
    apiClient.post<Types.ShiftInstance>(`/shifts/${id}/close`, { notes }),

  getCurrent: (branchId: string) =>
    apiClient.get<Types.ShiftInstance>('/shifts/current', {
      params: { branchId },
    }),

  getHistory: (params: {
    branchId: string;
    startDate?: string;
    endDate?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }) => apiClient.get<Types.PaginatedResponse<Types.ShiftInstance>>('/shifts/history', { params }),

  getById: (id: string) => apiClient.get<Types.ShiftInstance>(`/shifts/${id}`),

  getAllShifts: () => apiClient.get<Types.Shift[]>('/shifts'),
};

// Meter readings endpoints
export const meterReadingsApi = {
  create: (data: {
    nozzleId: string;
    shiftInstanceId: string;
    readingType: 'opening' | 'closing';
    meterValue: number;
    imageUrl?: string;
    ocrResult?: number;
    isManualOverride?: boolean;
  }) => apiClient.post<Types.MeterReading>('/meter-readings', data),

  getLatest: (nozzleId: string) =>
    apiClient.get<Types.MeterReading>(`/meter-readings/${nozzleId}/latest`),

  verify: (id: string, verifiedValue: number, isManualOverride: boolean) =>
    apiClient.put<Types.MeterReading>(`/meter-readings/${id}/verify`, {
      verifiedValue,
      isManualOverride,
    }),

  getByShift: (shiftId: string) =>
    apiClient.get<Types.MeterReading[]>(`/meter-readings/shift/${shiftId}`),

  getVariance: (shiftId: string) =>
    apiClient.get(`/meter-readings/shift/${shiftId}/variance`),
};

// Sales endpoints
export const salesApi = {
  createFuelSale: (data: {
    branchId: string;
    shiftInstanceId?: string;
    nozzleId: string;
    fuelTypeId: string;
    quantityLiters: number;
    pricePerLiter: number;
    paymentMethod: Types.PaymentMethod;
    vehicleNumber?: string;
    slipNumber?: string;
    customerId?: string;
  }) => apiClient.post<Types.FuelSale>('/sales/fuel', data),

  createNonFuelSale: (data: {
    branchId: string;
    shiftInstanceId?: string;
    items: Array<{
      productId: string;
      quantity: number;
      unitPrice: number;
    }>;
    paymentMethod: Types.PaymentMethod;
    taxAmount?: number;
    discountAmount?: number;
    customerId?: string;
  }) => apiClient.post<Types.NonFuelSale>('/sales/non-fuel', data),

  getAll: (params: {
    branchId?: string;
    shiftInstanceId?: string;
    saleType?: 'fuel' | 'non_fuel';
    paymentMethod?: Types.PaymentMethod;
    customerId?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }) => apiClient.get<Types.PaginatedResponse<Types.FuelSale | Types.NonFuelSale>>('/sales', { params }),

  getById: (id: string) =>
    apiClient.get<Types.FuelSale | Types.NonFuelSale>(`/sales/${id}`),

  getSummary: (params: {
    branchId: string;
    shiftInstanceId?: string;
    startDate?: string;
    endDate?: string;
  }) => apiClient.get<{ summary: Types.SalesSummary }>('/sales/summary', { params }),
};

// Customers endpoints
export const customersApi = {
  getAll: (params?: {
    search?: string;
    isActive?: boolean;
    limit?: number;
    offset?: number;
  }) => apiClient.get<Types.PaginatedResponse<Types.Customer>>('/customers', { params }),

  create: (data: {
    name: string;
    phone?: string;
    email?: string;
    address?: string;
    vehicleNumbers?: string[];
    creditLimit?: number;
    creditDays?: number;
  }) => apiClient.post<Types.Customer>('/customers', data),

  getById: (id: string) => apiClient.get<Types.Customer>(`/customers/${id}`),

  update: (id: string, data: Partial<Types.Customer>) =>
    apiClient.put<Types.Customer>(`/customers/${id}`, data),

  getLedger: (id: string, params: { startDate?: string; endDate?: string }) =>
    apiClient.get(`/customers/${id}/ledger`, { params }),
};

// Products endpoints
export const productsApi = {
  getAll: (params?: {
    search?: string;
    category?: string;
    isActive?: boolean;
    limit?: number;
    offset?: number;
  }) => apiClient.get<Types.PaginatedResponse<Types.Product>>('/products', { params }),

  search: (q: string) =>
    apiClient.get<Types.Product[]>('/products/search', { params: { q } }),

  create: (data: {
    sku: string;
    name: string;
    category: string;
    barcode?: string;
    unitPrice: number;
    costPrice?: number;
    lowStockThreshold?: number;
  }) => apiClient.post<Types.Product>('/products', data),

  getById: (id: string) => apiClient.get<Types.Product>(`/products/${id}`),

  update: (id: string, data: Partial<Types.Product>) =>
    apiClient.put<Types.Product>(`/products/${id}`, data),

  getStock: (id: string, branchId?: string) =>
    apiClient.get(`/products/${id}/stock`, { params: { branchId } }),

  updateStock: (id: string, branchId: string, quantity: number) =>
    apiClient.put(`/products/${id}/stock`, { branchId, quantity }),

  getCategories: () => apiClient.get<string[]>('/products/categories'),

  getLowStock: (branchId?: string) =>
    apiClient.get<Types.StockLevel[]>('/products/low-stock', {
      params: { branchId },
    }),
};

// Bifurcation endpoints
export const bifurcationApi = {
  create: (data: {
    branchId: string;
    date: string;
    shiftInstanceId?: string;
    pmgTotalLiters: number;
    pmgTotalAmount: number;
    hsdTotalLiters: number;
    hsdTotalAmount: number;
    cashAmount: number;
    creditAmount: number;
    cardAmount: number;
    psoCardAmount: number;
    expectedTotal: number;
    actualTotal: number;
    varianceNotes?: string;
  }) => apiClient.post<Types.Bifurcation>('/bifurcation', data),

  getByDate: (date: string, branchId: string) =>
    apiClient.get<Types.Bifurcation>(`/bifurcation/${date}`, {
      params: { branchId },
    }),

  verify: (id: string) =>
    apiClient.put<Types.Bifurcation>(`/bifurcation/${id}/verify`),

  getPending: (branchId: string) =>
    apiClient.get<Types.Bifurcation[]>('/bifurcation/pending', {
      params: { branchId },
    }),

  getHistory: (params: {
    branchId: string;
    startDate?: string;
    endDate?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }) => apiClient.get<Types.PaginatedResponse<Types.Bifurcation>>('/bifurcation/history', { params }),

  getById: (id: string) => apiClient.get<Types.Bifurcation>(`/bifurcation/${id}`),
};

// Reports endpoints
export const reportsApi = {
  dailySales: (branchId: string, date: string) =>
    apiClient.get('/reports/daily-sales', { params: { branchId, date } }),

  shift: (shiftInstanceId: string) =>
    apiClient.get('/reports/shift', { params: { shiftInstanceId } }),

  variance: (branchId: string, startDate: string, endDate: string) =>
    apiClient.get('/reports/variance', {
      params: { branchId, startDate, endDate },
    }),

  customerLedger: (customerId: string, startDate: string, endDate: string) =>
    apiClient.get('/reports/customer-ledger', {
      params: { customerId, startDate, endDate },
    }),

  inventory: (branchId: string) =>
    apiClient.get('/reports/inventory', { params: { branchId } }),
};
