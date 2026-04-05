import { apiClient } from './client';
import { Supplier } from './suppliers';

export interface PurchaseOrderItem {
  id: string;
  itemType: 'fuel' | 'product';
  fuelTypeId?: string;
  productId?: string;
  fuelType?: { id: string; code: string; name: string };
  product?: { id: string; name: string; sku: string };
  quantityOrdered: number;
  quantityReceived: number;
  costPerUnit: number;
  totalCost: number;
}

export interface PurchaseOrder {
  id: string;
  organizationId: string;
  branchId: string;
  supplierId: string;
  poNumber: string;
  orderDate: string;
  receivedDate?: string;
  status: 'draft' | 'confirmed' | 'partial_received' | 'received' | 'cancelled';
  totalAmount: number;
  paidAmount: number;
  isFullyReceived: boolean;
  notes?: string;
  supplier?: Supplier;
  branch?: { id: string; name: string };
  items: PurchaseOrderItem[];
  createdAt: string;
  updatedAt: string;
}

export interface CreatePOItemInput {
  itemType: 'fuel' | 'product';
  fuelTypeId?: string;
  productId?: string;
  quantityOrdered: number;
  costPerUnit: number;
}

export interface CreatePOInput {
  supplierId: string;
  branchId: string;
  poNumber: string;
  orderDate: string;
  items: CreatePOItemInput[];
  notes?: string;
}

export interface ReceiveStockInput {
  receiptNumber: string;
  receiptDate: string;
  items: { poItemId: string; quantityReceived: number }[];
  notes?: string;
}

export interface RecordPaymentInput {
  paymentDate: string;
  amount: number;
  paymentMethod: 'cash' | 'bank_transfer' | 'cheque';
  referenceNumber?: string;
  notes?: string;
}

export const purchaseOrdersApi = {
  getAll: async (params?: {
    supplierId?: string;
    branchId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }) => {
    const response = await apiClient.get<{ purchaseOrders: PurchaseOrder[]; pagination: { total: number; limit: number; offset: number; pages: number } }>('/api/purchase-orders', { params });
    return response.data;
  },

  getById: async (id: string): Promise<PurchaseOrder> => {
    const response = await apiClient.get<PurchaseOrder>(`/api/purchase-orders/${id}`);
    return response.data;
  },

  create: async (data: CreatePOInput): Promise<PurchaseOrder> => {
    const response = await apiClient.post<PurchaseOrder>('/api/purchase-orders', data);
    return response.data;
  },

  update: async (id: string, data: Partial<CreatePOInput>): Promise<PurchaseOrder> => {
    const response = await apiClient.put<PurchaseOrder>(`/api/purchase-orders/${id}`, data);
    return response.data;
  },

  confirm: async (id: string): Promise<PurchaseOrder> => {
    const response = await apiClient.post<PurchaseOrder>(`/api/purchase-orders/${id}/confirm`);
    return response.data;
  },

  cancel: async (id: string): Promise<PurchaseOrder> => {
    const response = await apiClient.post<PurchaseOrder>(`/api/purchase-orders/${id}/cancel`);
    return response.data;
  },

  receiveStock: async (id: string, data: ReceiveStockInput) => {
    const response = await apiClient.post(`/api/purchase-orders/${id}/receive`, data);
    return response.data;
  },

  recordPayment: async (id: string, data: RecordPaymentInput) => {
    const response = await apiClient.post(`/api/purchase-orders/${id}/payment`, data);
    return response.data;
  },
};
