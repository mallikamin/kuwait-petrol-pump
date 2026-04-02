import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShoppingCart, Plus, Eye, CheckCircle, XCircle, Truck, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import {
  purchaseOrdersApi,
  CreatePOInput,
  CreatePOItemInput,
  PurchaseOrder,
  PurchaseOrderItem,
  ReceiveStockInput,
  RecordPaymentInput,
} from '@/api/purchase-orders';
import { suppliersApi } from '@/api/suppliers';
import { apiClient } from '@/api/client';
import { formatCurrency, formatDate } from '@/utils/format';

interface LineItem extends CreatePOItemInput {
  id: string;
}

const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'warning' | 'success' }> = {
  draft: { label: 'Draft', variant: 'secondary' },
  confirmed: { label: 'Confirmed', variant: 'default' },
  partial_received: { label: 'Partial', variant: 'warning' },
  received: { label: 'Received', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'destructive' },
};

function generateTempId() {
  return `temp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function PurchaseOrders() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [receiveDialogOpen, setReceiveDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [createStep, setCreateStep] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const [poForm, setPoForm] = useState({
    supplierId: '',
    branchId: '',
    poNumber: '',
    orderDate: new Date().toISOString().split('T')[0],
    notes: '',
  });
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { id: generateTempId(), itemType: 'fuel', quantityOrdered: 0, costPerUnit: 0 },
  ]);

  const [receiveItems, setReceiveItems] = useState<{ poItemId: string; quantityReceived: number }[]>([]);
  const [receiveForm, setReceiveForm] = useState({
    receiptNumber: '',
    receiptDate: new Date().toISOString().split('T')[0],
    notes: '',
  });

  const [paymentForm, setPaymentForm] = useState<RecordPaymentInput>({
    paymentDate: new Date().toISOString().split('T')[0],
    amount: 0,
    paymentMethod: 'cash',
    referenceNumber: '',
    notes: '',
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: poData, isLoading } = useQuery({
    queryKey: ['purchase-orders', statusFilter],
    queryFn: () =>
      purchaseOrdersApi.getAll({
        status: statusFilter !== 'all' ? statusFilter : undefined,
        limit: 50,
      }),
  });

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => suppliersApi.getAll({ isActive: 'true', limit: 100 }),
  });

  const { data: fuelTypesData } = useQuery({
    queryKey: ['fuel-types'],
    queryFn: async () => {
      const res = await apiClient.get<{ fuelTypes: Array<{ id: string; code: string; name: string }> }>('/api/fuel-prices');
      return res.data;
    },
  });

  const { data: productsData } = useQuery({
    queryKey: ['products-list'],
    queryFn: async () => {
      const res = await apiClient.get<{ products: Array<{ id: string; name: string; sku: string }>; pagination: unknown }>('/api/products');
      return res.data;
    },
  });

  const { data: branchesData } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const res = await apiClient.get<Array<{ id: string; name: string }>>('/api/branches');
      return res.data;
    },
  });

  const purchaseOrders = poData?.purchaseOrders ?? [];
  const suppliers = suppliersData?.suppliers ?? [];
  const fuelTypes = fuelTypesData?.fuelTypes ?? [];
  const products = productsData?.products ?? [];
  const branches = Array.isArray(branchesData) ? branchesData : [];

  const createMutation = useMutation({
    mutationFn: (data: CreatePOInput) => purchaseOrdersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      resetCreateForm();
      setCreateDialogOpen(false);
      toast({ title: 'Success', description: 'Purchase order created' });
    },
    onError: (error: unknown) => {
      const msg = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast({ title: 'Error', description: msg || 'Failed to create purchase order', variant: 'destructive' });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (id: string) => purchaseOrdersApi.confirm(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      toast({ title: 'Success', description: 'Purchase order confirmed' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to confirm purchase order', variant: 'destructive' });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => purchaseOrdersApi.cancel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      setViewDialogOpen(false);
      toast({ title: 'Success', description: 'Purchase order cancelled' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to cancel purchase order', variant: 'destructive' });
    },
  });

  const receiveMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: ReceiveStockInput }) =>
      purchaseOrdersApi.receiveStock(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      setReceiveDialogOpen(false);
      setSelectedPO(null);
      toast({ title: 'Success', description: 'Stock received successfully' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to receive stock', variant: 'destructive' });
    },
  });

  const paymentMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: RecordPaymentInput }) =>
      purchaseOrdersApi.recordPayment(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      setPaymentDialogOpen(false);
      setSelectedPO(null);
      toast({ title: 'Success', description: 'Payment recorded successfully' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to record payment', variant: 'destructive' });
    },
  });

  function resetCreateForm() {
    setPoForm({
      supplierId: '',
      branchId: '',
      poNumber: '',
      orderDate: new Date().toISOString().split('T')[0],
      notes: '',
    });
    setLineItems([{ id: generateTempId(), itemType: 'fuel', quantityOrdered: 0, costPerUnit: 0 }]);
    setCreateStep(1);
  }

  function handleOpenCreate() {
    resetCreateForm();
    setCreateDialogOpen(true);
  }

  function handleView(po: PurchaseOrder) {
    setSelectedPO(po);
    setViewDialogOpen(true);
  }

  function handleOpenReceive(po: PurchaseOrder) {
    setSelectedPO(po);
    setReceiveItems(
      (po.items ?? []).map((item) => ({
        poItemId: item.id,
        quantityReceived: 0,
      }))
    );
    setReceiveForm({
      receiptNumber: '',
      receiptDate: new Date().toISOString().split('T')[0],
      notes: '',
    });
    setReceiveDialogOpen(true);
  }

  function handleOpenPayment(po: PurchaseOrder) {
    setSelectedPO(po);
    setPaymentForm({
      paymentDate: new Date().toISOString().split('T')[0],
      amount: Math.max((po.totalAmount ?? 0) - (po.paidAmount ?? 0), 0),
      paymentMethod: 'cash',
      referenceNumber: '',
      notes: '',
    });
    setPaymentDialogOpen(true);
  }

  function addLineItem() {
    setLineItems((prev) => [
      ...prev,
      { id: generateTempId(), itemType: 'fuel', quantityOrdered: 0, costPerUnit: 0 },
    ]);
  }

  function removeLineItem(id: string) {
    setLineItems((prev) => (prev.length <= 1 ? prev : prev.filter((item) => item.id !== id)));
  }

  function updateLineItem(id: string, field: string, value: string | number) {
    setLineItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const updated = { ...item, [field]: value };
        if (field === 'itemType') {
          delete updated.fuelTypeId;
          delete updated.productId;
        }
        return updated;
      })
    );
  }

  function getLineItemTotal(item: LineItem): number {
    return (item.quantityOrdered ?? 0) * (item.costPerUnit ?? 0);
  }

  function getGrandTotal(): number {
    return lineItems.reduce((sum, item) => sum + getLineItemTotal(item), 0);
  }

  function getItemDisplayName(item: PurchaseOrderItem): string {
    if (item.itemType === 'fuel') {
      return item.fuelType?.name ?? 'Unknown Fuel';
    }
    return item.product?.name ?? 'Unknown Product';
  }

  function validateStep1(): boolean {
    if (!poForm.supplierId) {
      toast({ title: 'Validation Error', description: 'Please select a supplier', variant: 'destructive' });
      return false;
    }
    if (!poForm.branchId) {
      toast({ title: 'Validation Error', description: 'Please select a branch', variant: 'destructive' });
      return false;
    }
    if (!poForm.poNumber.trim()) {
      toast({ title: 'Validation Error', description: 'PO number is required', variant: 'destructive' });
      return false;
    }
    return true;
  }

  function validateStep2(): boolean {
    for (const item of lineItems) {
      if (item.itemType === 'fuel' && !item.fuelTypeId) {
        toast({ title: 'Validation Error', description: 'Please select a fuel type for all fuel items', variant: 'destructive' });
        return false;
      }
      if (item.itemType === 'product' && !item.productId) {
        toast({ title: 'Validation Error', description: 'Please select a product for all product items', variant: 'destructive' });
        return false;
      }
      if (item.quantityOrdered <= 0) {
        toast({ title: 'Validation Error', description: 'All items must have a quantity greater than zero', variant: 'destructive' });
        return false;
      }
      if (item.costPerUnit <= 0) {
        toast({ title: 'Validation Error', description: 'All items must have a cost per unit greater than zero', variant: 'destructive' });
        return false;
      }
    }
    return true;
  }

  function handleCreateSubmit() {
    if (!validateStep2()) return;

    const items: CreatePOItemInput[] = lineItems.map(({ itemType, fuelTypeId, productId, quantityOrdered, costPerUnit }) => {
      const base: CreatePOItemInput = { itemType, quantityOrdered, costPerUnit };
      if (itemType === 'fuel' && fuelTypeId) base.fuelTypeId = fuelTypeId;
      if (itemType === 'product' && productId) base.productId = productId;
      return base;
    });

    createMutation.mutate({
      supplierId: poForm.supplierId,
      branchId: poForm.branchId,
      poNumber: poForm.poNumber,
      orderDate: poForm.orderDate,
      items,
      notes: poForm.notes || undefined,
    });
  }

  function handleReceiveSubmit() {
    if (!selectedPO) return;
    if (!receiveForm.receiptNumber.trim()) {
      toast({ title: 'Validation Error', description: 'Receipt number is required', variant: 'destructive' });
      return;
    }
    const validItems = receiveItems.filter((ri) => ri.quantityReceived > 0);
    if (validItems.length === 0) {
      toast({ title: 'Validation Error', description: 'Enter quantity received for at least one item', variant: 'destructive' });
      return;
    }
    receiveMutation.mutate({
      id: selectedPO.id,
      data: {
        receiptNumber: receiveForm.receiptNumber,
        receiptDate: receiveForm.receiptDate,
        items: validItems,
        notes: receiveForm.notes || undefined,
      },
    });
  }

  function handlePaymentSubmit() {
    if (!selectedPO) return;
    if (paymentForm.amount <= 0) {
      toast({ title: 'Validation Error', description: 'Payment amount must be greater than zero', variant: 'destructive' });
      return;
    }
    paymentMutation.mutate({
      id: selectedPO.id,
      data: paymentForm,
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Purchase Orders</h1>
          <p className="text-muted-foreground">Manage supplier orders, receive stock, and track payments</p>
        </div>
        <Button onClick={handleOpenCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Create PO
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" />
              Purchase Orders
            </CardTitle>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="partial_received">Partial Received</SelectItem>
                <SelectItem value="received">Received</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(8)].map((_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : purchaseOrders.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <ShoppingCart className="mx-auto h-12 w-12 mb-4 opacity-50" />
              <p>No purchase orders found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO Number</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchaseOrders.map((po) => {
                  const config = STATUS_CONFIG[po.status] ?? STATUS_CONFIG.draft;
                  return (
                    <TableRow key={po.id}>
                      <TableCell className="font-medium">{po.poNumber}</TableCell>
                      <TableCell>{po.supplier?.name ?? 'N/A'}</TableCell>
                      <TableCell>{po.branch?.name ?? 'N/A'}</TableCell>
                      <TableCell>{formatDate(po.orderDate, 'PP')}</TableCell>
                      <TableCell>
                        <Badge variant={config.variant}>{config.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(po.totalAmount ?? 0)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(po.paidAmount ?? 0)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm" onClick={() => handleView(po)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          {po.status === 'draft' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => confirmMutation.mutate(po.id)}
                              disabled={confirmMutation.isPending}
                            >
                              <CheckCircle className="h-4 w-4 text-green-600" />
                            </Button>
                          )}
                          {(po.status === 'confirmed' || po.status === 'partial_received') && (
                            <Button variant="ghost" size="sm" onClick={() => handleOpenReceive(po)}>
                              <Truck className="h-4 w-4 text-blue-600" />
                            </Button>
                          )}
                          {po.status !== 'received' && po.status !== 'cancelled' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => cancelMutation.mutate(po.id)}
                              disabled={cancelMutation.isPending}
                            >
                              <XCircle className="h-4 w-4 text-red-600" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={createDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCreateDialogOpen(false);
            resetCreateForm();
          }
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Purchase Order</DialogTitle>
            <DialogDescription>
              {createStep === 1 ? 'Step 1: Order details' : 'Step 2: Add line items'}
            </DialogDescription>
          </DialogHeader>

          {createStep === 1 && (
            <div className="grid grid-cols-2 gap-4 py-4">
              <div className="space-y-2">
                <Label>Supplier *</Label>
                <Select value={poForm.supplierId} onValueChange={(v) => setPoForm({ ...poForm, supplierId: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Branch *</Label>
                <Select value={poForm.branchId} onValueChange={(v) => setPoForm({ ...poForm, branchId: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>PO Number *</Label>
                <Input
                  value={poForm.poNumber}
                  onChange={(e) => setPoForm({ ...poForm, poNumber: e.target.value })}
                  placeholder="e.g., PO-2026-001"
                />
              </div>
              <div className="space-y-2">
                <Label>Order Date</Label>
                <Input
                  type="date"
                  value={poForm.orderDate}
                  onChange={(e) => setPoForm({ ...poForm, orderDate: e.target.value })}
                />
              </div>
              <div className="col-span-2 space-y-2">
                <Label>Notes</Label>
                <Input
                  value={poForm.notes}
                  onChange={(e) => setPoForm({ ...poForm, notes: e.target.value })}
                  placeholder="Optional notes"
                />
              </div>
            </div>
          )}

          {createStep === 2 && (
            <div className="space-y-4 py-4">
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[130px]">Type</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead className="w-[120px]">Quantity</TableHead>
                      <TableHead className="w-[140px]">Cost/Unit</TableHead>
                      <TableHead className="w-[120px] text-right">Total</TableHead>
                      <TableHead className="w-[50px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lineItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <Select
                            value={item.itemType}
                            onValueChange={(v) => updateLineItem(item.id, 'itemType', v)}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="fuel">Fuel</SelectItem>
                              <SelectItem value="product">Product</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          {item.itemType === 'fuel' ? (
                            <Select
                              value={item.fuelTypeId ?? ''}
                              onValueChange={(v) => updateLineItem(item.id, 'fuelTypeId', v)}
                            >
                              <SelectTrigger className="h-9">
                                <SelectValue placeholder="Select fuel" />
                              </SelectTrigger>
                              <SelectContent>
                                {fuelTypes.map((ft) => (
                                  <SelectItem key={ft.id} value={ft.id}>{ft.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Select
                              value={item.productId ?? ''}
                              onValueChange={(v) => updateLineItem(item.id, 'productId', v)}
                            >
                              <SelectTrigger className="h-9">
                                <SelectValue placeholder="Select product" />
                              </SelectTrigger>
                              <SelectContent>
                                {products.map((p) => (
                                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            className="h-9"
                            value={item.quantityOrdered || ''}
                            onChange={(e) =>
                              updateLineItem(item.id, 'quantityOrdered', parseFloat(e.target.value) || 0)
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            className="h-9"
                            value={item.costPerUnit || ''}
                            onChange={(e) =>
                              updateLineItem(item.id, 'costPerUnit', parseFloat(e.target.value) || 0)
                            }
                          />
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(getLineItemTotal(item))}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeLineItem(item.id)}
                            disabled={lineItems.length <= 1}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between">
                <Button variant="outline" size="sm" onClick={addLineItem}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Item
                </Button>
                <div className="text-lg font-semibold">
                  Grand Total: {formatCurrency(getGrandTotal())}
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            {createStep === 2 && (
              <Button variant="outline" onClick={() => setCreateStep(1)}>
                Back
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                setCreateDialogOpen(false);
                resetCreateForm();
              }}
            >
              Cancel
            </Button>
            {createStep === 1 ? (
              <Button
                onClick={() => {
                  if (validateStep1()) setCreateStep(2);
                }}
              >
                Next
              </Button>
            ) : (
              <Button onClick={handleCreateSubmit} disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating...' : 'Create PO'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Purchase Order: {selectedPO?.poNumber ?? ''}</DialogTitle>
            <DialogDescription>Order details and line items</DialogDescription>
          </DialogHeader>

          {selectedPO && (
            <div className="space-y-6 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Supplier</p>
                  <p className="font-medium">{selectedPO.supplier?.name ?? 'N/A'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Branch</p>
                  <p className="font-medium">{selectedPO.branch?.name ?? 'N/A'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Order Date</p>
                  <p className="font-medium">{formatDate(selectedPO.orderDate, 'PP')}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <Badge variant={(STATUS_CONFIG[selectedPO.status] ?? STATUS_CONFIG.draft).variant}>
                    {(STATUS_CONFIG[selectedPO.status] ?? STATUS_CONFIG.draft).label}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Amount</p>
                  <p className="font-medium">{formatCurrency(selectedPO.totalAmount ?? 0)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Paid Amount</p>
                  <p className="font-medium">{formatCurrency(selectedPO.paidAmount ?? 0)}</p>
                </div>
                {selectedPO.notes && (
                  <div className="col-span-2">
                    <p className="text-sm text-muted-foreground">Notes</p>
                    <p className="font-medium">{selectedPO.notes}</p>
                  </div>
                )}
              </div>

              <div>
                <h4 className="font-semibold mb-2">Line Items</h4>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Ordered</TableHead>
                        <TableHead className="text-right">Received</TableHead>
                        <TableHead className="text-right">Cost/Unit</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(selectedPO.items ?? []).map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">{getItemDisplayName(item)}</TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {item.itemType === 'fuel' ? 'Fuel' : 'Product'}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">{item.quantityOrdered ?? 0}</TableCell>
                          <TableCell className="text-right">{item.quantityReceived ?? 0}</TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(item.costPerUnit ?? 0)}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(item.totalCost ?? 0)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                {selectedPO.status === 'draft' && (
                  <Button
                    onClick={() => {
                      confirmMutation.mutate(selectedPO.id);
                      setViewDialogOpen(false);
                    }}
                    disabled={confirmMutation.isPending}
                  >
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Confirm PO
                  </Button>
                )}
                {(selectedPO.status === 'confirmed' || selectedPO.status === 'partial_received') && (
                  <Button
                    onClick={() => {
                      setViewDialogOpen(false);
                      handleOpenReceive(selectedPO);
                    }}
                  >
                    <Truck className="mr-2 h-4 w-4" />
                    Receive Stock
                  </Button>
                )}
                {selectedPO.status !== 'cancelled' && (selectedPO.totalAmount ?? 0) > (selectedPO.paidAmount ?? 0) && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setViewDialogOpen(false);
                      handleOpenPayment(selectedPO);
                    }}
                  >
                    Record Payment
                  </Button>
                )}
                {selectedPO.status !== 'received' && selectedPO.status !== 'cancelled' && (
                  <Button
                    variant="destructive"
                    onClick={() => cancelMutation.mutate(selectedPO.id)}
                    disabled={cancelMutation.isPending}
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    Cancel PO
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={receiveDialogOpen} onOpenChange={setReceiveDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Receive Stock: {selectedPO?.poNumber ?? ''}</DialogTitle>
            <DialogDescription>Enter quantities received for each item</DialogDescription>
          </DialogHeader>

          {selectedPO && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Receipt Number *</Label>
                  <Input
                    value={receiveForm.receiptNumber}
                    onChange={(e) => setReceiveForm({ ...receiveForm, receiptNumber: e.target.value })}
                    placeholder="e.g., GRN-001"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Receipt Date</Label>
                  <Input
                    type="date"
                    value={receiveForm.receiptDate}
                    onChange={(e) => setReceiveForm({ ...receiveForm, receiptDate: e.target.value })}
                  />
                </div>
              </div>

              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Ordered</TableHead>
                      <TableHead className="text-right">Already Received</TableHead>
                      <TableHead className="w-[140px]">Qty Receiving</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(selectedPO.items ?? []).map((item, idx) => {
                      const remaining = (item.quantityOrdered ?? 0) - (item.quantityReceived ?? 0);
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">{getItemDisplayName(item)}</TableCell>
                          <TableCell className="text-right">{item.quantityOrdered ?? 0}</TableCell>
                          <TableCell className="text-right">{item.quantityReceived ?? 0}</TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min="0"
                              max={remaining}
                              className="h-9"
                              value={receiveItems[idx]?.quantityReceived || ''}
                              onChange={(e) => {
                                const val = Math.min(parseFloat(e.target.value) || 0, remaining);
                                setReceiveItems((prev) =>
                                  prev.map((ri, i) =>
                                    i === idx ? { ...ri, quantityReceived: val } : ri
                                  )
                                );
                              }}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="space-y-2">
                <Label>Notes</Label>
                <Input
                  value={receiveForm.notes}
                  onChange={(e) => setReceiveForm({ ...receiveForm, notes: e.target.value })}
                  placeholder="Optional notes"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiveDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleReceiveSubmit} disabled={receiveMutation.isPending}>
              {receiveMutation.isPending ? 'Receiving...' : 'Confirm Receipt'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Payment: {selectedPO?.poNumber ?? ''}</DialogTitle>
            <DialogDescription>
              Outstanding: {formatCurrency(Math.max((selectedPO?.totalAmount ?? 0) - (selectedPO?.paidAmount ?? 0), 0))}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Amount *</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={paymentForm.amount || ''}
                onChange={(e) =>
                  setPaymentForm({ ...paymentForm, amount: parseFloat(e.target.value) || 0 })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Payment Method</Label>
              <Select
                value={paymentForm.paymentMethod}
                onValueChange={(v) =>
                  setPaymentForm({ ...paymentForm, paymentMethod: v as RecordPaymentInput['paymentMethod'] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Payment Date</Label>
              <Input
                type="date"
                value={paymentForm.paymentDate}
                onChange={(e) => setPaymentForm({ ...paymentForm, paymentDate: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Reference Number</Label>
              <Input
                value={paymentForm.referenceNumber ?? ''}
                onChange={(e) => setPaymentForm({ ...paymentForm, referenceNumber: e.target.value })}
                placeholder="e.g., Cheque #, Transfer ref"
              />
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Input
                value={paymentForm.notes ?? ''}
                onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                placeholder="Optional"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handlePaymentSubmit} disabled={paymentMutation.isPending}>
              {paymentMutation.isPending ? 'Recording...' : 'Record Payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
