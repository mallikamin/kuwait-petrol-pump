import { useState, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { CustomerSelector } from '@/components/ui/customer-selector';
import { useToast } from '@/components/ui/use-toast';
import { useAuthStore } from '@/store/auth';
import { productsApi, branchesApi, fuelPricesApi, customersApi } from '@/api';
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
  Fuel,
  AlertCircle,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

type PaymentMethod = 'cash' | 'credit' | 'card' | 'pso_card' | 'other';
type SaleTab = 'fuel' | 'product';

interface CartItem {
  productId: string;
  name: string;
  sku: string;
  unitPrice: number;
  quantity: number;
}

interface FuelCartItem {
  nozzleId: string;
  nozzleName: string;
  fuelTypeId: string;
  fuelTypeName: string;
  quantityLiters: number;
  pricePerLiter: number;
}

export function POS() {
  const { toast } = useToast();
  const { user } = useAuthStore();
  const receiptRef = useRef<HTMLDivElement>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<SaleTab>('fuel');

  // Product search (for non-fuel tab)
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // Cart state
  const [cart, setCart] = useState<CartItem[]>([]);
  const [fuelCart, setFuelCart] = useState<FuelCartItem | null>(null);

  // Fuel sale form
  const [selectedNozzleId, setSelectedNozzleId] = useState('');
  const [liters, setLiters] = useState('');

  // Customer selection (both tabs)
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [vehicleNumber, setVehicleNumber] = useState('');

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

  // Fetch nozzles
  const { data: nozzlesData } = useQuery({
    queryKey: ['pos-nozzles', branchId],
    queryFn: async () => {
      if (!branchId) return [];
      const branches = await branchesApi.getAll();
      const branch = branches.items.find(b => b.id === branchId);
      if (!branch) return [];
      const dispensingUnits = await branchesApi.getDispensingUnits(branch.id);
      return dispensingUnits.flatMap(unit =>
        unit.nozzles.map(n => ({
          ...n,
          displayName: `${n.nozzleNumber} - ${n.fuelType?.name || 'Unknown'}`,
        }))
      );
    },
    enabled: !!branchId,
  });

  // Fetch current fuel prices (with pricePerLiter)
  const { data: currentPrices } = useQuery({
    queryKey: ['fuel-prices-current'],
    queryFn: () => fuelPricesApi.getCurrentPrices(),
  });

  // Build price lookup: fuelTypeId -> pricePerLiter
  const priceLookup = new Map<string, number>();
  currentPrices?.forEach((p: any) => {
    if (p.fuelTypeId && p.pricePerLiter) {
      const existing = priceLookup.get(p.fuelTypeId);
      if (!existing) priceLookup.set(p.fuelTypeId, Number(p.pricePerLiter));
    }
  });

  // Fetch customers
  const { data: customersData } = useQuery({
    queryKey: ['pos-customers'],
    queryFn: () => customersApi.getAll({ size: 500 }),
    staleTime: 300000,
  });

  const customers = customersData?.items || [];
  const selectedCustomer = selectedCustomerId && selectedCustomerId !== 'none'
    ? customers.find(c => c.id === selectedCustomerId)
    : undefined;

  // Get unique categories from products
  const products = productsData?.items || [];
  const categories = [...new Set(products.map(p => p.category).filter(Boolean))] as string[];
  const filteredProducts = categoryFilter === 'all'
    ? products
    : products.filter(p => p.category === categoryFilter);

  // Cart helpers (non-fuel)
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

  const clearCart = useCallback(() => {
    setCart([]);
    setFuelCart(null);
    setLiters('');
    setSelectedNozzleId('');
    setSelectedCustomerId('');
    setVehicleNumber('');
    setSlipNumber('');
  }, []);

  // Fuel cart helpers
  const addFuelToCart = useCallback(() => {
    if (!selectedNozzleId || !liters || parseFloat(liters) <= 0) {
      toast({ title: 'Invalid input', description: 'Select a nozzle and enter liters', variant: 'destructive' });
      return;
    }

    const nozzle = nozzlesData?.find(n => n.id === selectedNozzleId);
    if (!nozzle || !nozzle.fuelType) {
      toast({ title: 'Error', description: 'Invalid nozzle or fuel type', variant: 'destructive' });
      return;
    }

    const pricePerLiter = priceLookup.get(nozzle.fuelTypeId) || 0;

    if (pricePerLiter <= 0) {
      toast({ title: 'Price not set', description: `No price configured for ${nozzle.fuelType.name}`, variant: 'destructive' });
      return;
    }

    setFuelCart({
      nozzleId: nozzle.id,
      nozzleName: nozzle.displayName,
      fuelTypeId: nozzle.fuelTypeId,
      fuelTypeName: nozzle.fuelType.name,
      quantityLiters: parseFloat(liters),
      pricePerLiter,
    });

    toast({ title: 'Fuel added', description: `${liters}L ${nozzle.fuelType.name}` });
  }, [selectedNozzleId, liters, nozzlesData, priceLookup, toast]);

  // Totals
  const subtotalNonFuel = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const subtotalFuel = fuelCart ? fuelCart.quantityLiters * fuelCart.pricePerLiter : 0;
  const totalAmount = activeTab === 'fuel' ? subtotalFuel : subtotalNonFuel;

  // Credit limit warning
  const creditLimitExceeded = selectedCustomer && selectedCustomer.current_balance + totalAmount > selectedCustomer.credit_limit;

  // Submit sale
  const handleSubmit = async () => {
    if (activeTab === 'fuel' && !fuelCart) {
      toast({ title: 'No fuel sale', description: 'Add fuel to cart before completing sale.', variant: 'destructive' });
      return;
    }

    if (activeTab === 'product' && cart.length === 0) {
      toast({ title: 'Cart is empty', description: 'Add products before completing sale.', variant: 'destructive' });
      return;
    }

    if (!branchId) {
      toast({ title: 'No branch assigned', description: 'Your user account has no branch. Contact admin.', variant: 'destructive' });
      return;
    }

    // Check credit limit
    if (creditLimitExceeded && paymentMethod === 'credit') {
      const confirmed = window.confirm(
        `Credit limit exceeded!\nCurrent balance: ${formatCurrency(selectedCustomer!.current_balance)}\nCredit limit: ${formatCurrency(selectedCustomer!.credit_limit)}\n\nProceed anyway?`
      );
      if (!confirmed) return;
    }

    setSubmitting(true);
    try {
      const saleData: Omit<QueuedSale, 'offlineQueueId' | 'queuedAt' | 'attempts' | 'status'> = {
        branchId,
        saleType: activeTab === 'fuel' ? 'fuel' : 'non_fuel',
        saleDate: new Date().toISOString(),
        totalAmount,
        paymentMethod,
        slipNumber: slipNumber || undefined,
        customerId: selectedCustomerId && selectedCustomerId !== 'none' ? selectedCustomerId : undefined,
        vehicleNumber: vehicleNumber || undefined,
        fuelSales: activeTab === 'fuel' && fuelCart ? [{
          nozzleId: fuelCart.nozzleId,
          fuelTypeId: fuelCart.fuelTypeId,
          quantityLiters: fuelCart.quantityLiters,
          pricePerLiter: fuelCart.pricePerLiter,
          totalAmount: fuelCart.quantityLiters * fuelCart.pricePerLiter,
        }] : undefined,
        nonFuelSales: activeTab === 'product' ? cart.map(item => ({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalAmount: item.unitPrice * item.quantity,
        })) : undefined,
      };

      const offlineQueueId = await OfflineQueue.enqueueSale(saleData);

      // Build receipt data
      const receipt: ReceiptData = {
        receiptNo: offlineQueueId.slice(0, 8).toUpperCase(),
        date: new Date().toLocaleString('en-PK'),
        cashier: user?.full_name || user?.username || 'Unknown',
        branch: 'Main Branch',
        items: activeTab === 'fuel' && fuelCart ? [{
          name: `${fuelCart.fuelTypeName} (${fuelCart.nozzleName})`,
          sku: `${fuelCart.quantityLiters}L`,
          quantity: fuelCart.quantityLiters,
          unitPrice: fuelCart.pricePerLiter,
          totalPrice: fuelCart.quantityLiters * fuelCart.pricePerLiter,
        }] : cart.map(item => ({
          name: item.name,
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.unitPrice * item.quantity,
        })),
        subtotal: totalAmount,
        taxAmount: 0,
        discountAmount: 0,
        totalAmount,
        paymentMethod,
        slipNumber: slipNumber || undefined,
        vehicleNumber: vehicleNumber || undefined,
        customerName: selectedCustomer?.name,
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
      clearCart();

      const itemsText = activeTab === 'fuel' && fuelCart
        ? `${fuelCart.quantityLiters}L ${fuelCart.fuelTypeName}`
        : `${cart.length} item(s)`;

      toast({ title: 'Sale completed', description: `${formatCurrency(totalAmount)} - ${itemsText}` });
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
          <p className="text-muted-foreground">Complete fuel and non-fuel sales</p>
        </div>
        <SyncStatus />
      </div>

      {!navigator.onLine && (
        <div className="flex items-center gap-2 rounded-md bg-yellow-50 dark:bg-yellow-900/20 p-3 text-sm text-yellow-800 dark:text-yellow-200">
          <WifiOff className="h-4 w-4" />
          Offline mode - sales will be saved locally and synced when back online
        </div>
      )}

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as SaleTab)} className="space-y-4">
        <TabsList className="grid w-full max-w-[400px] grid-cols-2">
          <TabsTrigger value="fuel" className="flex items-center gap-2">
            <Fuel className="h-4 w-4" />
            Fuel Sale
          </TabsTrigger>
          <TabsTrigger value="product" className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            Product Sale
          </TabsTrigger>
        </TabsList>

        {/* FUEL SALE TAB */}
        <TabsContent value="fuel" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Left: Fuel Sale Form (2 cols) */}
            <div className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>Fuel Sale</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Nozzle Selection */}
                  <div className="space-y-2">
                    <Label>Nozzle *</Label>
                    <Select value={selectedNozzleId} onValueChange={setSelectedNozzleId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select nozzle" />
                      </SelectTrigger>
                      <SelectContent>
                        {nozzlesData?.map(nozzle => (
                          <SelectItem key={nozzle.id} value={nozzle.id}>
                            {nozzle.displayName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Fuel Type & Price Display */}
                  {selectedNozzleId && (() => {
                    const nozzle = nozzlesData?.find(n => n.id === selectedNozzleId);
                    const price = nozzle ? (priceLookup.get(nozzle.fuelTypeId) || 0) : 0;
                    return (
                      <div className="p-3 rounded-lg border bg-muted/50">
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="text-sm font-medium">{nozzle?.fuelType?.name || 'Unknown'}</p>
                            <p className="text-xs text-muted-foreground">Fuel Type</p>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-bold">{formatCurrency(price)}/L</p>
                            <p className="text-xs text-muted-foreground">Current Price</p>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Liters Input */}
                  <div className="space-y-2">
                    <Label>Quantity (Liters) *</Label>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={liters}
                      onChange={(e) => setLiters(e.target.value)}
                    />
                  </div>

                  {/* Total Calculation Display */}
                  {selectedNozzleId && liters && parseFloat(liters) > 0 && (() => {
                    const nozzle = nozzlesData?.find(n => n.id === selectedNozzleId);
                    const price = nozzle ? (priceLookup.get(nozzle.fuelTypeId) || 0) : 0;
                    const total = parseFloat(liters) * price;
                    return (
                      <div className="p-4 rounded-lg border-2 border-primary bg-primary/5">
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-muted-foreground">Total Amount</span>
                          <span className="text-2xl font-bold">{formatCurrency(total)}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {liters}L × {formatCurrency(price)}/L
                        </div>
                      </div>
                    );
                  })()}

                  <Button onClick={addFuelToCart} className="w-full" disabled={!selectedNozzleId || !liters}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add to Cart
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* Right: Cart + Checkout (shared with both tabs) */}
            {renderCheckoutPanel()}
          </div>
        </TabsContent>

        {/* PRODUCT SALE TAB */}
        <TabsContent value="product" className="space-y-4">
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

            {/* Right: Cart + Checkout (shared) */}
            {renderCheckoutPanel()}
          </div>
        </TabsContent>
      </Tabs>

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

  // Shared checkout panel for both tabs
  function renderCheckoutPanel() {
    const hasItems = activeTab === 'fuel' ? !!fuelCart : cart.length > 0;

    return (
      <div className="space-y-4">
        {/* Cart Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5" />
                Cart {activeTab === 'fuel' ? (fuelCart ? '(1)' : '(0)') : `(${cart.length})`}
              </span>
              {hasItems && (
                <Button variant="ghost" size="sm" onClick={clearCart} className="text-xs h-7">
                  <X className="h-3 w-3 mr-1" />
                  Clear
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!hasItems ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                {activeTab === 'fuel' ? 'Add fuel to cart above' : 'Tap products to add them to cart'}
              </p>
            ) : activeTab === 'fuel' && fuelCart ? (
              <div className="space-y-2">
                <div className="p-3 rounded-md bg-muted/50">
                  <p className="text-sm font-medium">{fuelCart.fuelTypeName}</p>
                  <p className="text-xs text-muted-foreground">{fuelCart.nozzleName}</p>
                  <div className="flex justify-between mt-2">
                    <span className="text-xs">{fuelCart.quantityLiters}L × {formatCurrency(fuelCart.pricePerLiter)}</span>
                    <span className="text-sm font-bold">{formatCurrency(fuelCart.quantityLiters * fuelCart.pricePerLiter)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {cart.map(item => (
                  <div key={item.productId} className="p-2 rounded-md bg-muted/50 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{item.name}</p>
                        <p className="text-xs text-muted-foreground">{formatCurrency(item.unitPrice)} each</p>
                      </div>
                      <p className="text-sm font-bold whitespace-nowrap">
                        {formatCurrency(item.unitPrice * item.quantity)}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          onClick={() => updateQuantity(item.productId, -1)}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="text-sm font-bold min-w-[2rem] text-center">{item.quantity}</span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7 shrink-0"
                          onClick={() => updateQuantity(item.productId, 1)}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-destructive"
                        onClick={() => removeFromCart(item.productId)}
                      >
                        <Trash2 className="h-3 w-3 mr-1" />
                        <span className="text-xs">Remove</span>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Totals */}
            {hasItems && (
              <div className="mt-4 pt-3 border-t space-y-2">
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
            <CardTitle className="text-base">Payment Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Customer Selection */}
            <div className="space-y-1.5">
              <Label className="text-xs">Customer (optional)</Label>
              <CustomerSelector
                customers={customers}
                value={selectedCustomerId}
                onChange={setSelectedCustomerId}
                placeholder="Walk-in customer"
              />
              {selectedCustomer && (
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <div className="flex justify-between">
                    <span>Balance:</span>
                    <span className="font-medium">{formatCurrency(selectedCustomer.current_balance)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Limit:</span>
                    <span className="font-medium">{formatCurrency(selectedCustomer.credit_limit)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Credit Limit Warning */}
            {creditLimitExceeded && paymentMethod === 'credit' && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Credit limit exceeded! Current: {formatCurrency(selectedCustomer!.current_balance)}, Limit: {formatCurrency(selectedCustomer!.credit_limit)}
                </AlertDescription>
              </Alert>
            )}

            {/* Vehicle Number (for fuel sales or customer sales) */}
            {(activeTab === 'fuel' || selectedCustomerId) && (
              <div className="space-y-1.5">
                <Label className="text-xs">Vehicle Number {activeTab === 'fuel' && paymentMethod === 'credit' ? '*' : '(optional)'}</Label>
                <Input
                  placeholder="e.g. ABC-1234"
                  value={vehicleNumber}
                  onChange={(e) => setVehicleNumber(e.target.value)}
                />
              </div>
            )}

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
              disabled={submitting || !hasItems || (activeTab === 'fuel' && paymentMethod === 'credit' && !vehicleNumber)}
              onClick={handleSubmit}
            >
              <Send className="mr-2 h-4 w-4" />
              {submitting ? 'Processing...' : `Complete Sale - ${formatCurrency(totalAmount)}`}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
}
