import { useState, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { useAuthStore } from '@/store/auth';
import { productsApi } from '@/api';
import { OfflineQueue, QueuedSale } from '@/db/indexeddb';
import { SyncStatus } from '@/components/SyncStatus';
import { Receipt, ReceiptData } from '@/components/Receipt';
import { formatCurrency } from '@/utils/format';
import { Product } from '@/types';
import {
  ShoppingCart,
  Search,
  Plus,
  Minus,
  Trash2,
  Printer,
  WifiOff,
  X,
  Package,
  Send,
} from 'lucide-react';

type PaymentMethod = 'cash' | 'credit' | 'card' | 'pso_card' | 'other';

interface CartItem {
  productId: string;
  name: string;
  sku: string;
  unitPrice: number;
  quantity: number;
}

export function POS() {
  const { toast } = useToast();
  const { user } = useAuthStore();
  const receiptRef = useRef<HTMLDivElement>(null);

  // Product search
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // Cart state
  const [cart, setCart] = useState<CartItem[]>([]);

  // Payment
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [slipNumber, setSlipNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Receipt dialog
  const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);

  const branchId = user?.branch_id || (user as any)?.branch?.id;

  // Fetch products
  const { data: productsData, isLoading: productsLoading } = useQuery({
    queryKey: ['pos-products', searchQuery],
    queryFn: () => productsApi.getAll({ search: searchQuery || undefined, size: 100 }),
    staleTime: 60000,
  });

  // Get unique categories from products
  const products = productsData?.items || [];
  const categories = [...new Set(products.map(p => p.category).filter(Boolean))] as string[];
  const filteredProducts = categoryFilter === 'all'
    ? products
    : products.filter(p => p.category === categoryFilter);

  // Cart helpers
  const addToCart = useCallback((product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.productId === product.id);
      if (existing) {
        return prev.map(item =>
          item.productId === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prev, {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        unitPrice: product.unitPrice,
        quantity: 1,
      }];
    });
  }, []);

  const updateQuantity = useCallback((productId: string, delta: number) => {
    setCart(prev =>
      prev
        .map(item =>
          item.productId === productId
            ? { ...item, quantity: Math.max(0, item.quantity + delta) }
            : item
        )
        .filter(item => item.quantity > 0)
    );
  }, []);

  const removeFromCart = useCallback((productId: string) => {
    setCart(prev => prev.filter(item => item.productId !== productId));
  }, []);

  const clearCart = useCallback(() => setCart([]), []);

  // Totals
  const subtotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const totalAmount = subtotal; // No tax for now

  // Submit sale
  const handleSubmit = async () => {
    if (cart.length === 0) {
      toast({ title: 'Cart is empty', description: 'Add products before completing sale.', variant: 'destructive' });
      return;
    }

    if (!branchId) {
      toast({ title: 'No branch assigned', description: 'Your user account has no branch. Contact admin.', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      const saleData: Omit<QueuedSale, 'offlineQueueId' | 'queuedAt' | 'attempts' | 'status'> = {
        branchId,
        saleType: 'non_fuel',
        saleDate: new Date().toISOString(),
        totalAmount,
        paymentMethod,
        slipNumber: slipNumber || undefined,
        nonFuelSales: cart.map(item => ({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalAmount: item.unitPrice * item.quantity,
        })),
      };

      const offlineQueueId = await OfflineQueue.enqueueSale(saleData);

      // Build receipt data
      const receipt: ReceiptData = {
        receiptNo: offlineQueueId.slice(0, 8).toUpperCase(),
        date: new Date().toLocaleString('en-PK'),
        cashier: user?.full_name || user?.username || 'Unknown',
        branch: 'Main Branch',
        items: cart.map(item => ({
          name: item.name,
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.unitPrice * item.quantity,
        })),
        subtotal,
        taxAmount: 0,
        discountAmount: 0,
        totalAmount,
        paymentMethod,
        slipNumber: slipNumber || undefined,
      };

      // Sync if online
      if (navigator.onLine) {
        try {
          const deviceId = localStorage.getItem('deviceId') || 'web-' + Math.random().toString(36).substr(2, 9);
          localStorage.setItem('deviceId', deviceId);
          await OfflineQueue.flushWhenOnline(deviceId);
        } catch {
          // Will sync later
        }
      }

      setReceiptData(receipt);
      setShowReceipt(true);

      // Reset form
      setCart([]);
      setSlipNumber('');

      toast({ title: 'Sale completed', description: `${formatCurrency(totalAmount)} - ${cart.length} item(s)` });
    } catch (err) {
      toast({ title: 'Sale failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  // Print receipt
  const handlePrint = () => {
    const printContent = receiptRef.current;
    if (!printContent) return;

    const printWindow = window.open('', '_blank', 'width=420,height=600');
    if (!printWindow) {
      toast({ title: 'Print blocked', description: 'Allow popups for this site to print receipts.', variant: 'destructive' });
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Receipt</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Courier New', monospace; font-size: 12px; padding: 8px; max-width: 380px; }
          .receipt-content { width: 100%; }
          h2 { font-size: 16px; margin-bottom: 2px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 2px 0; text-align: left; }
          th:nth-child(2), td:nth-child(2) { text-align: center; }
          th:nth-child(3), td:nth-child(3),
          th:nth-child(4), td:nth-child(4) { text-align: right; }
          .dashed { border-bottom: 1px dashed #999; margin: 6px 0; }
          .dotted { border-bottom: 1px dotted #ddd; }
          .solid { border-bottom: 1px solid #999; margin: 4px 0; }
          .center { text-align: center; }
          .right { text-align: right; }
          .bold { font-weight: bold; }
          .total-row { font-size: 14px; font-weight: bold; }
          .meta-row { display: flex; justify-content: space-between; }
          .text-gray { color: #666; }
          .mb-1 { margin-bottom: 4px; }
          .mb-2 { margin-bottom: 8px; }
          .mb-3 { margin-bottom: 12px; }
          .mt-1 { margin-top: 4px; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>
        ${printContent.innerHTML}
        <script>window.onload = function() { window.print(); window.close(); }<\/script>
      </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Point of Sale</h1>
          <p className="text-muted-foreground">Select products and complete sales</p>
        </div>
        <SyncStatus />
      </div>

      {!navigator.onLine && (
        <div className="flex items-center gap-2 rounded-md bg-yellow-50 dark:bg-yellow-900/20 p-3 text-sm text-yellow-800 dark:text-yellow-200">
          <WifiOff className="h-4 w-4" />
          Offline mode - sales will be saved locally and synced when back online
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left: Product Catalog (2 cols) */}
        <div className="lg:col-span-2 space-y-4">
          {/* Search + Filter */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search products by name or SKU..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map(cat => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Product Grid */}
          {productsLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-28 rounded-lg bg-muted animate-pulse" />
              ))}
            </div>
          ) : filteredProducts.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Package className="h-12 w-12 mb-2" />
                <p>No products found</p>
                {searchQuery && <p className="text-xs">Try a different search term</p>}
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {filteredProducts.map(product => {
                const inCart = cart.find(c => c.productId === product.id);
                return (
                  <button
                    key={product.id}
                    onClick={() => addToCart(product)}
                    className="relative text-left p-3 rounded-lg border bg-card hover:bg-accent hover:border-primary/50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <p className="font-medium text-sm truncate">{product.name}</p>
                    <p className="text-xs text-muted-foreground">{product.sku}</p>
                    <p className="text-sm font-bold mt-1">{formatCurrency(product.unitPrice)}</p>
                    {product.category && (
                      <Badge variant="outline" className="mt-1 text-[10px] px-1 py-0">{product.category}</Badge>
                    )}
                    {inCart && (
                      <span className="absolute top-2 right-2 bg-primary text-primary-foreground text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                        {inCart.quantity}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Cart + Checkout (1 col) */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <ShoppingCart className="h-5 w-5" />
                  Cart ({cart.length})
                </span>
                {cart.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearCart} className="text-xs h-7">
                    <X className="h-3 w-3 mr-1" />
                    Clear
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {cart.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Tap products to add them to cart
                </p>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {cart.map(item => (
                    <div key={item.productId} className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.name}</p>
                        <p className="text-xs text-muted-foreground">{formatCurrency(item.unitPrice)} each</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => updateQuantity(item.productId, -1)}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="text-sm font-bold w-6 text-center">{item.quantity}</span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => updateQuantity(item.productId, 1)}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={() => removeFromCart(item.productId)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                      <p className="text-sm font-bold w-20 text-right">
                        {formatCurrency(item.unitPrice * item.quantity)}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* Totals */}
              {cart.length > 0 && (
                <div className="mt-4 pt-3 border-t space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>{formatCurrency(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold">
                    <span>Total</span>
                    <span>{formatCurrency(totalAmount)}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Payment Section */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Payment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Payment Method</Label>
                <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="credit">Credit</SelectItem>
                    <SelectItem value="pso_card">PSO Card</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Slip Number (optional)</Label>
                <Input
                  placeholder="e.g. SL-0001"
                  value={slipNumber}
                  onChange={(e) => setSlipNumber(e.target.value)}
                />
              </div>

              <Button
                className="w-full"
                size="lg"
                disabled={submitting || cart.length === 0}
                onClick={handleSubmit}
              >
                <Send className="mr-2 h-4 w-4" />
                {submitting ? 'Processing...' : `Complete Sale - ${formatCurrency(totalAmount)}`}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Receipt Dialog */}
      <Dialog open={showReceipt} onOpenChange={setShowReceipt}>
        <DialogContent className="max-w-[460px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Sale Receipt</DialogTitle>
          </DialogHeader>
          {receiptData && (
            <>
              <div className="border rounded-lg overflow-hidden">
                <Receipt ref={receiptRef} data={receiptData} />
              </div>
              <DialogFooter className="flex gap-2 sm:gap-2">
                <Button variant="outline" onClick={() => setShowReceipt(false)}>
                  Close
                </Button>
                <Button onClick={handlePrint}>
                  <Printer className="mr-2 h-4 w-4" />
                  Print Receipt
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
