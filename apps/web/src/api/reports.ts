import { apiClient } from './client';

export const reportsApi = {
  getDailySales: async (branchId: string, date?: string, startDate?: string, endDate?: string): Promise<any> => {
    const params: any = { branchId };
    // Date filter precedence:
    // 1. If startDate/endDate provided => range mode
    // 2. Else if date provided => single-date mode
    // 3. Else => no filter (all data)
    if (startDate && endDate) {
      params.startDate = startDate;
      params.endDate = endDate;
    } else if (date) {
      params.date = date;
    }
    // If neither provided, no-filter mode (no date params sent to API)
    const response = await apiClient.get('/api/reports/daily-sales', { params });
    return response.data.report || response.data;
  },

  getShiftReport: async (shiftInstanceId: string): Promise<any> => {
    const response = await apiClient.get('/api/reports/shift', {
      params: { shiftInstanceId },
    });
    return response.data.report || response.data;
  },

  getVarianceReport: async (branchId: string, date?: string, startDate?: string, endDate?: string): Promise<any> => {
    const params: any = { branchId };
    // Date filter precedence:
    // 1. If startDate/endDate provided => range mode
    // 2. Else if date provided => single-date mode
    // 3. Else => no filter (all data)
    if (startDate && endDate) {
      params.startDate = startDate;
      params.endDate = endDate;
    } else if (date) {
      params.date = date;
    }
    const response = await apiClient.get('/api/reports/variance', { params });
    return response.data.report || response.data;
  },

  getCustomerLedger: async (customerId: string, date?: string, startDate?: string, endDate?: string): Promise<any> => {
    const params: any = { customerId };
    // Date filter precedence:
    // 1. If startDate/endDate provided => range mode
    // 2. Else if date provided => single-date mode
    // 3. Else => no filter (all data)
    if (startDate && endDate) {
      params.startDate = startDate;
      params.endDate = endDate;
    } else if (date) {
      params.date = date;
    }
    const response = await apiClient.get('/api/reports/customer-ledger', { params });
    return response.data.report || response.data;
  },

  getInventoryReport: async (
    branchId: string,
    asOfDate?: string,
    startDate?: string,
    endDate?: string,
    category?: 'all' | 'HSD' | 'PMG' | 'non_fuel',
    productId?: string,
  ): Promise<any> => {
    const params: any = { branchId };
    // Date filter precedence:
    // 1. If startDate/endDate provided => range mode
    // 2. Else if asOfDate provided => single-date mode
    // 3. Else => no filter (all purchases)
    if (startDate && endDate) {
      params.startDate = startDate;
      params.endDate = endDate;
    } else if (asOfDate) {
      params.asOfDate = asOfDate;
    }
    // Product-Wise Movement filters — server applies them; UI/CSV stay consistent.
    if (category && category !== 'all') params.category = category;
    if (productId) params.productId = productId;
    const response = await apiClient.get('/api/reports/inventory', { params });
    return response.data.report || response.data;
  },

  getFuelPriceHistory: async (date?: string, startDate?: string, endDate?: string): Promise<any> => {
    const params: any = {};
    // Date filter precedence:
    // 1. If startDate/endDate provided => range mode
    // 2. Else if date provided => single-date mode
    // 3. Else => no filter (all data)
    if (startDate && endDate) {
      params.startDate = startDate;
      params.endDate = endDate;
    } else if (date) {
      params.date = date;
    }
    const response = await apiClient.get('/api/reports/fuel-price-history', { params });
    return response.data.report || response.data;
  },

  getCustomerWiseSales: async (branchId: string, date?: string, startDate?: string, endDate?: string, customerId?: string): Promise<any> => {
    const params: any = { branchId };
    if (customerId) {
      params.customerId = customerId;
    }
    // Date filter precedence:
    // 1. If startDate/endDate provided => range mode
    // 2. Else if date provided => single-date mode
    // 3. Else => no filter (all data)
    if (startDate && endDate) {
      params.startDate = startDate;
      params.endDate = endDate;
    } else if (date) {
      params.date = date;
    }
    const response = await apiClient.get('/api/reports/customer-wise-sales', { params });
    return response.data.report || response.data;
  },

  getProductWiseSummary: async (
    branchId: string,
    date?: string,
    startDate?: string,
    endDate?: string,
    productType: 'all' | 'fuel' | 'non_fuel' = 'all',
    productId?: string
  ): Promise<any> => {
    const params: any = { branchId, productType };
    if (productId) {
      params.productId = productId;
    }
    if (startDate && endDate) {
      params.startDate = startDate;
      params.endDate = endDate;
    } else if (date) {
      params.date = date;
    }
    const response = await apiClient.get('/api/reports/product-wise-summary', { params });
    return response.data.report || response.data;
  },
};
