import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productsApi, salesApi, customersApi } from '../api/endpoints';
import { useAppStore } from '../store/appStore';
import { useCartStore } from '../store/cartStore';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { formatCurrency } from '../utils/format';
import { toast } from 'sonner';
import { ShoppingCart, Trash2, Plus, Minus, Search, Barcode } from 'lucide-react';
import type { PaymentMethod, Product } from '@shared/types';

export const NonFuelPOS: React.FC = () => {
  const queryClient = useQueryClient();
  const { currentBranch, currentShift } = useAppStore();
  const { items, addItem, removeItem, updateQuantity, clearCart, getSubtotal, getTotalItems } =
    useCartStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [customerId, setCustomerId] = useState('');
  const [taxRate] = useState(0); // Kuwait has 0% VAT currently
  const [discountAmount, setDiscountAmount] = useState(0);

  // Search products
  const { data: productsData, isLoading: loadingProducts } = useQuery({
    queryKey: ['products-search', searchQuery],
    queryFn: () => productsApi.search(searchQuery),
    enabled: searchQuery.length >= 2,
  });

  // Fetch customers
  const { data: customersData } = useQuery({
    queryKey: ['customers'],
    queryFn: () => customersApi.getAll({ isActive: true, limit: 100 }),
  });

  const products = productsData?.data || [];
  const customers = customersData?.data.items || [];

  const subtotal = getSubtotal();
  const taxAmount = subtotal * taxRate;
  const total = subtotal + taxAmount - discountAmount;

  // Create non-fuel sale mutation
  const createSaleMutation = useMutation({
    mutationFn: (data: any) => salesApi.createNonFuelSale(data),
    onSuccess: (response) => {
      toast.success('Sale completed successfully');
      queryClient.invalidateQueries({ queryKey: ['sales-summary'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['low-stock'] });

      // Print receipt
      if (window.api) {
        window.api.printReceipt(response.data);
      }

      // Clear cart
      clearCart();
      setCustomerId('');
      setDiscountAmount(0);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to complete sale');
    },
  });

  const handleCheckout = () => {
    if (!currentBranch) {
      toast.error('Please select a branch');
      return;
    }

    if (items.length === 0) {
      toast.error('Cart is empty');
      return;
    }

    createSaleMutation.mutate({
      branchId: currentBranch.id,
      shiftInstanceId: currentShift?.id,
      items: items.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
      paymentMethod,
      taxAmount,
      discountAmount,
      customerId: customerId || undefined,
    });
  };

  const handleBarcodeInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchQuery) {
      const product = products.find(
        (p: Product) => p.barcode === searchQuery || p.sku === searchQuery
      );
      if (product) {
        addItem(product);
        setSearchQuery('');
        toast.success(`Added ${product.name} to cart`);
      }
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Non-Fuel POS</h1>
        <p className="mt-1 text-sm text-slate-600">Sell products and manage shopping cart</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Product Search & Selection */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Product Search
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Search Input */}
            <div className="relative mb-4">
              <Input
                placeholder="Search by SKU, name, or scan barcode..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleBarcodeInput}
                className="pr-10"
              />
              <Barcode className="absolute right-3 top-3 h-5 w-5 text-slate-400" />
            </div>

            {/* Product Results */}
            <div className="space-y-2">
              {loadingProducts && (
                <p className="text-sm text-slate-500">Searching...</p>
              )}

              {searchQuery.length >= 2 && !loadingProducts && products.length === 0 && (
                <p className="text-sm text-slate-500">No products found</p>
              )}

              {products.map((product: Product) => (
                <div
                  key={product.id}
                  className="flex items-center justify-between rounded-lg border border-slate-200 p-3 hover:bg-slate-50"
                >
                  <div className="flex-1">
                    <p className="font-medium text-slate-900">{product.name}</p>
                    <p className="text-sm text-slate-600">
                      SKU: {product.sku} | {product.category}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="text-lg font-semibold text-slate-900">
                      {formatCurrency(product.unitPrice)}
                    </p>
                    <Button
                      size="sm"
                      onClick={() => {
                        addItem(product);
                        toast.success(`Added ${product.name} to cart`);
                      }}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Shopping Cart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" />
              Cart ({getTotalItems()})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Cart Items */}
              <div className="max-h-96 space-y-2 overflow-y-auto">
                {items.length === 0 ? (
                  <p className="text-sm text-slate-500">Cart is empty</p>
                ) : (
                  items.map((item) => (
                    <div
                      key={item.product.id}
                      className="rounded-lg border border-slate-200 p-3"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="font-medium text-slate-900">
                            {item.product.name}
                          </p>
                          <p className="text-sm text-slate-600">
                            {formatCurrency(item.unitPrice)} each
                          </p>
                        </div>
                        <button
                          onClick={() => removeItem(item.product.id)}
                          className="text-red-600 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="mt-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() =>
                              updateQuantity(item.product.id, item.quantity - 1)
                            }
                            className="rounded bg-slate-200 p-1 hover:bg-slate-300"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="w-8 text-center font-medium">
                            {item.quantity}
                          </span>
                          <button
                            onClick={() =>
                              updateQuantity(item.product.id, item.quantity + 1)
                            }
                            className="rounded bg-slate-200 p-1 hover:bg-slate-300"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                        <p className="font-semibold text-slate-900">
                          {formatCurrency(item.unitPrice * item.quantity)}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Payment Details */}
              {items.length > 0 && (
                <>
                  <div className="space-y-2 border-t border-slate-200 pt-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Subtotal</span>
                      <span className="font-medium">{formatCurrency(subtotal)}</span>
                    </div>

                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600">Tax ({taxRate * 100}%)</span>
                      <span className="font-medium">{formatCurrency(taxAmount)}</span>
                    </div>

                    <Input
                      type="number"
                      label="Discount"
                      value={discountAmount}
                      onChange={(e) => setDiscountAmount(parseFloat(e.target.value) || 0)}
                      step="0.001"
                      min="0"
                      max={subtotal}
                    />

                    <div className="flex justify-between border-t border-slate-200 pt-2 text-lg font-bold">
                      <span>Total</span>
                      <span className="text-blue-600">{formatCurrency(total)}</span>
                    </div>
                  </div>

                  <Select
                    label="Payment Method"
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                    options={[
                      { value: 'cash', label: 'Cash' },
                      { value: 'credit', label: 'Credit' },
                      { value: 'card', label: 'Card' },
                      { value: 'pso_card', label: 'PSO Card' },
                    ]}
                  />

                  <Select
                    label="Customer (Optional)"
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                    options={[
                      { value: '', label: 'Select customer' },
                      ...customers.map((c) => ({ value: c.id, label: c.name })),
                    ]}
                  />

                  <div className="space-y-2">
                    <Button
                      variant="primary"
                      className="w-full"
                      size="lg"
                      onClick={handleCheckout}
                      isLoading={createSaleMutation.isPending}
                    >
                      Complete Sale
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => clearCart()}
                    >
                      Clear Cart
                    </Button>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
