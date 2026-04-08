import { useState, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
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
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { CustomerSelector } from '@/components/ui/customer-selector';
import { useToast } from '@/components/ui/use-toast';
import { useAuthStore } from '@/store/auth';
import { productsApi, fuelPricesApi, customersApi, dashboardApi, salesApi, banksApi } from '@/api';
import { OfflineQueue, QueuedSale } from '@/db/indexeddb';
import { SyncStatus } from '@/components/SyncStatus';
import { Receipt, ReceiptData } from '@/components/Receipt';
// Meter reading removed - use dedicated Meter Readings page instead
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
  Copy,
  Users,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

type PaymentMethod = 'cash' | 'credit_card' | 'bank_card' | 'pso_card' | 'credit_customer';
type SaleTab = 'fuel' | 'product';

// Map UI payment method to backend API enum
const mapPaymentMethodToAPI = (uiMethod: PaymentMethod): string => {
  const mapping: Record<PaymentMethod, string> = {
    cash: 'cash',
    credit_customer: 'credit',
    credit_card: 'card',
    bank_card: 'card',
    pso_card: 'pso_card',
  };
  return mapping[uiMethod];
};

interface CartItem {
  productId: string;
  name: string;
  sku: string;
  unitPrice: number;
  quantity: number;
}

interface FuelTransaction {
  id: string; // Local ID for tracking
  customerId: string;
  customerName: string;
  vehicleNumber: string;
  slipNumber: string;
  paymentMethod: PaymentMethod;
  bankId: string; // Required for credit_card/bank_card
  fuelTypeId: string;
  fuelTypeName: string;
  quantityLiters: string;
  pricePerLiter: string;
  lineTotal: string;
}

export function POS() {
  const { toast } = useToast();
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const receiptRef = useRef<HTMLDivElement>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<SaleTab>('fuel');

  // Product search (for non-fuel tab)
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // Cart state
  const [cart, setCart] = useState<CartItem[]>([]);
  const [fuelTransactions, setFuelTransactions] = useState<FuelTransaction[]>([]);

  // Fuel grouped layout state
  const [isAddFuelGroupOpen, setIsAddFuelGroupOpen] = useState(false);
  const [fuelCustomerSearchQuery, setFuelCustomerSearchQuery] = useState('');
  const [openFuelAccordionItems, setOpenFuelAccordionItems] = useState<string[]>([]);
  const [showAddFuelCustomerDialog, setShowAddFuelCustomerDialog] = useState(false);
  const [isSubmittingFuelCustomer, setIsSubmittingFuelCustomer] = useState(false);
  const [newFuelCustomer, setNewFuelCustomer] = useState({ name: '', phone: '', email: '' });

  // Customer selection (non-fuel tab only)
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [vehicleNumber, setVehicleNumber] = useState('');

  // Payment
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [selectedBankId, setSelectedBankId] = useState<string>('');
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

  // Fetch fuel types
  const { data: fuelTypes } = useQuery({
    queryKey: ['fuel-types'],
    queryFn: () => fuelPricesApi.getFuelTypes(),
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
  const { data: customersData, isLoading: customersLoading, error: customersError, refetch: refetchCustomers } = useQuery({
    queryKey: ['pos-customers'],
    queryFn: () => customersApi.getAll({ size: 500 }),
    staleTime: 300000,
  });

  // Fetch liters sold (PMG/HSD)
  const { data: litersData } = useQuery({
    queryKey: ['liters-sold'],
    queryFn: () => dashboardApi.getLitersSold(),
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  // Fetch today's sales
  const { data: todaysSalesData } = useQuery({
    queryKey: ['todays-sales'],
    queryFn: () => salesApi.getTodaysSales(),
    refetchInterval: 10000, // Refetch every 10 seconds
  });

  // Fetch banks (for card payments)
  const { data: banksData } = useQuery({
    queryKey: ['banks'],
    queryFn: () => banksApi.getAll(),
    staleTime: 300000,
  });

  const customers = customersData?.items || [];
  const banks = banksData?.banks || [];
  const selectedCustomer = selectedCustomerId && selectedCustomerId !== 'none'
    ? customers.find(c => c.id === selectedCustomerId)
    : undefined;

  // Get unique categories from products
  const products = productsData?.items || [];
  const categories = [...new Set(products.map(p => p.category).filter(Boolean))] as string[];
  const filteredProducts = categoryFilter === 'all'
    ? products
    : products.filter(p => p.category === categoryFilter);

  // Fuel customer grouping (newest first)
  const fuelCustomerGroups = useMemo(() => {
    const grouped = new Map<string, { indices: number[]; txns: FuelTransaction[] }>();
    fuelTransactions.forEach((txn, idx) => {
      const key = txn.customerId;
      if (!grouped.has(key)) grouped.set(key, { indices: [], txns: [] });
      grouped.get(key)!.indices.push(idx);
      grouped.get(key)!.txns.push(txn);
    });
    // Sort groups by most recent first (highest first index = added later)
    return Array.from(grouped.entries())
      .map(([customerId, { indices, txns }]) => ({
        customerId,
        customerName: txns[0]?.customerName || 'Unknown',
        indices,
        txns,
        total: txns.reduce((sum, t) => sum + parseFloat(t.lineTotal || '0'), 0),
      }))
      .sort((a, b) => Math.max(...b.indices) - Math.max(...a.indices));
  }, [fuelTransactions]);

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
    setFuelTransactions([]);
    setSelectedCustomerId('');
    setVehicleNumber('');
    setSlipNumber('');
  }, []);

  // Fuel transaction helpers (grouped layout)
  const addFuelTransactionToCustomer = (customerId: string, customerName: string) => {
    const newTransaction: FuelTransaction = {
      id: `fuel-${Date.now()}-${Math.random()}`,
      customerId,
      customerName,
      vehicleNumber: '',
      slipNumber: '',
      paymentMethod: 'cash',
      bankId: '',
      fuelTypeId: '',
      fuelTypeName: '',
      quantityLiters: '',
      pricePerLiter: '',
      lineTotal: '0',
    };
    setFuelTransactions(prev => [...prev, newTransaction]);

    // Ensure accordion is open
    if (!openFuelAccordionItems.includes(customerId)) {
      setOpenFuelAccordionItems(prev => [...prev, customerId]);
    }
  };

  const duplicateLastFuelInGroup = (indices: number[]) => {
    if (indices.length === 0) return;
    const lastIdx = Math.max(...indices);
    const lastTxn = fuelTransactions[lastIdx];
    if (!lastTxn) return;

    const duplicate: FuelTransaction = {
      ...lastTxn,
      id: `fuel-${Date.now()}-${Math.random()}`,
      vehicleNumber: '', // Clear vehicle number for new entry
      slipNumber: '', // Clear slip number for new entry
    };
    setFuelTransactions(prev => [...prev, duplicate]);
  };

  const updateFuelTransaction = (index: number, field: keyof FuelTransaction, value: any) => {
    setFuelTransactions(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };

      // Recalculate lineTotal if quantity or price changes
      if (field === 'quantityLiters' || field === 'pricePerLiter') {
        const qty = parseFloat(updated[index].quantityLiters || '0');
        const price = parseFloat(updated[index].pricePerLiter || '0');
        updated[index].lineTotal = (qty * price).toFixed(2);
      }

      // Auto-populate price when fuel type changes
      if (field === 'fuelTypeId' && value) {
        const fuelType = fuelTypes?.find(ft => ft.id === value);
        if (fuelType) {
          updated[index].fuelTypeName = fuelType.name;
          const price = priceLookup.get(fuelType.id) || 0;
          updated[index].pricePerLiter = price.toFixed(2);

          // Recalculate total if quantity exists
          const qty = parseFloat(updated[index].quantityLiters || '0');
          updated[index].lineTotal = (qty * price).toFixed(2);
        }
      }

      return updated;
    });
  };

  const removeFuelTransaction = (index: number) => {
    setFuelTransactions(prev => prev.filter((_, i) => i !== index));
  };

  const addFuelCustomerGroup = (customerId: string, customerName: string) => {
    addFuelTransactionToCustomer(customerId, customerName);
    setIsAddFuelGroupOpen(false);
    setFuelCustomerSearchQuery('');
  };

  const handleAddNewFuelCustomer = async () => {
    if (!newFuelCustomer.name.trim()) {
      toast({ title: 'Customer name required', description: 'Please enter a customer name', variant: 'destructive' });
      return;
    }

    setIsSubmittingFuelCustomer(true);
    try {
      const response = await customersApi.create({
        name: newFuelCustomer.name.trim(),
        phone: newFuelCustomer.phone.trim() || undefined,
        email: newFuelCustomer.email.trim() || undefined,
      });

      const customer = response;
      toast({ title: 'Success', description: 'Customer added successfully' });

      // Keep select dialog open, close create dialog
      setShowAddFuelCustomerDialog(false);
      setIsAddFuelGroupOpen(true);
      setNewFuelCustomer({ name: '', phone: '', email: '' });
      setFuelCustomerSearchQuery('');

      // Refresh customer list and wait for completion
      await refetchCustomers();

      // Auto-add fuel transaction for this customer (this will close isAddFuelGroupOpen)
      if (customer && customer.id && customer.name) {
        addFuelCustomerGroup(customer.id, customer.name);
      }
    } catch (error: any) {
      toast({ title: 'Error', description: error?.response?.data?.message || 'Failed to add customer', variant: 'destructive' });
    } finally {
      setIsSubmittingFuelCustomer(false);
    }
  };

  // Legacy fuel cart helper - removed in Phase A (grouped layout replaces this)

  // Totals
  const subtotalNonFuel = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const subtotalFuel = fuelTransactions.reduce((sum, txn) => sum + parseFloat(txn.lineTotal || '0'), 0);
  const totalAmount = activeTab === 'fuel' ? subtotalFuel : subtotalNonFuel;

  // Credit limit warning (current_balance not yet implemented in backend, using 0 for now)
  const currentBalance = 0; // TODO: Fetch from backend
  const creditLimitExceeded = selectedCustomer && currentBalance + totalAmount > (selectedCustomer.creditLimit || 0);

  // Submit sale
  const handleSubmit = async () => {
    if (activeTab === 'fuel' && fuelTransactions.length === 0) {
      toast({ title: 'No fuel transactions', description: 'Add at least one fuel transaction before completing sale.', variant: 'destructive' });
      return;
    }

    if (activeTab === 'product' && cart.length === 0) {
      toast({ title: 'Cart is empty', description: 'Add products before completing sale.', variant: 'destructive' });
      return;
    }

    // Phase B - Validate individual fuel transactions
    if (activeTab === 'fuel') {
      const invalidTxns = fuelTransactions.filter(
        txn => !txn.fuelTypeId || !txn.quantityLiters || parseFloat(txn.quantityLiters) <= 0 || !txn.paymentMethod
      );
      if (invalidTxns.length > 0) {
        toast({
          title: 'Incomplete transactions',
          description: `${invalidTxns.length} row(s) missing fuel type, quantity, or payment method. Complete all rows before submitting.`,
          variant: 'destructive',
        });
        return;
      }

      // Validate credit_customer rows have vehicle# + slip#
      const missingCreditFields = fuelTransactions.filter(
        txn => txn.paymentMethod === 'credit_customer' && (!txn.vehicleNumber || !txn.slipNumber)
      );
      if (missingCreditFields.length > 0) {
        toast({
          title: 'Credit customer requirements',
          description: 'Credit customer sales require vehicle number and slip number for all transactions.',
          variant: 'destructive',
        });
        return;
      }

      // Validate card rows have bankId
      const missingBanks = fuelTransactions.filter(
        txn => (txn.paymentMethod === 'credit_card' || txn.paymentMethod === 'bank_card') && !txn.bankId
      );
      if (missingBanks.length > 0) {
        toast({
          title: 'Bank required',
          description: 'Card payments require bank selection for all transactions.',
          variant: 'destructive',
        });
        return;
      }

      // Validate same payment method within each customer group
      for (const group of fuelCustomerGroups) {
        const paymentMethods = new Set(group.txns.map(txn => txn.paymentMethod));
        if (paymentMethods.size > 1) {
          toast({
            title: 'Mixed payment methods not allowed',
            description: `Customer "${group.customerName}" has transactions with different payment methods. All transactions for the same customer must use the same payment method.`,
            variant: 'destructive',
          });
          return;
        }
      }
    }

    if (!branchId) {
      toast({ title: 'No branch assigned', description: 'Your user account has no branch. Contact admin.', variant: 'destructive' });
      return;
    }

    // Check credit limit (product tab only - fuel uses per-customer grouping)
    if (activeTab === 'product' && creditLimitExceeded && paymentMethod === 'credit_customer') {
      const confirmed = window.confirm(
        `Credit limit exceeded!\nCurrent balance: ${formatCurrency(currentBalance)}\nCredit limit: ${formatCurrency(selectedCustomer!.creditLimit || 0)}\n\nProceed anyway?`
      );
      if (!confirmed) return;
    }

    setSubmitting(true);
    try {
      // Phase B - Fuel tab: Create one sale per customer group
      const queuedSaleIds: string[] = [];

      if (activeTab === 'fuel') {
        // Group transactions by customer
        for (const group of fuelCustomerGroups) {
          const groupTotal = group.txns.reduce((sum, txn) => sum + parseFloat(txn.lineTotal || '0'), 0);

          // Derive sale-level payment details from first row (all rows have same payment method due to validation)
          const firstTxn = group.txns[0];
          const groupPaymentMethod = firstTxn.paymentMethod;
          const groupBankId = (groupPaymentMethod === 'credit_card' || groupPaymentMethod === 'bank_card')
            ? (firstTxn.bankId && firstTxn.bankId.trim() !== '' ? firstTxn.bankId : undefined)
            : undefined;
          const groupSlipNumber = firstTxn.slipNumber && firstTxn.slipNumber.trim() !== '' ? firstTxn.slipNumber : undefined;

          const saleData: Omit<QueuedSale, 'offlineQueueId' | 'queuedAt' | 'attempts' | 'status'> = {
            branchId,
            saleType: 'fuel',
            saleDate: new Date().toISOString(),
            totalAmount: groupTotal,
            paymentMethod: mapPaymentMethodToAPI(groupPaymentMethod) as any, // Map to backend enum
            bankId: groupBankId,
            slipNumber: groupSlipNumber,
            customerId: group.customerId,
            vehicleNumber: undefined, // Each fuel sale has its own vehicle number
            fuelSales: group.txns.map(txn => ({
              nozzleId: undefined, // No nozzle tracking in POS (undefined, not empty string)
              fuelTypeId: txn.fuelTypeId,
              quantityLiters: parseFloat(txn.quantityLiters || '0'),
              pricePerLiter: parseFloat(txn.pricePerLiter || '0'),
              totalAmount: parseFloat(txn.lineTotal || '0'),
            })),
          };

          const queueId = await OfflineQueue.enqueueSale(saleData);
          queuedSaleIds.push(queueId);
        }
      } else {
        // Product tab: Single sale
        const saleData: Omit<QueuedSale, 'offlineQueueId' | 'queuedAt' | 'attempts' | 'status'> = {
          branchId,
          saleType: 'non_fuel',
          saleDate: new Date().toISOString(),
          totalAmount,
          paymentMethod: mapPaymentMethodToAPI(paymentMethod) as any, // Map to backend enum
          bankId: (paymentMethod === 'credit_card' || paymentMethod === 'bank_card')
            ? (selectedBankId && selectedBankId.trim() !== '' ? selectedBankId : undefined)
            : undefined,
          slipNumber: slipNumber && slipNumber.trim() !== '' ? slipNumber : undefined,
          customerId: selectedCustomerId && selectedCustomerId !== 'none' && selectedCustomerId.trim() !== '' ? selectedCustomerId : undefined,
          vehicleNumber: vehicleNumber && vehicleNumber.trim() !== '' ? vehicleNumber : undefined,
          nonFuelSales: cart.map(item => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalAmount: item.unitPrice * item.quantity,
          })),
        };

        const queueId = await OfflineQueue.enqueueSale(saleData);
        queuedSaleIds.push(queueId);
      }

      const offlineQueueId = queuedSaleIds[0]; // Use first ID for receipt number

      // Build combined receipt data
      const receipt: ReceiptData = {
        receiptNo: offlineQueueId.slice(0, 8).toUpperCase() + (queuedSaleIds.length > 1 ? ` (+${queuedSaleIds.length - 1})` : ''),
        date: new Date().toLocaleString('en-PK'),
        cashier: user?.full_name || user?.username || 'Unknown',
        branch: 'Main Branch',
        items: activeTab === 'fuel' && fuelTransactions.length > 0 ? fuelTransactions.map(txn => ({
          name: `${txn.fuelTypeName} (${txn.customerName})`,
          sku: `${txn.vehicleNumber || 'N/A'}`,
          quantity: parseFloat(txn.quantityLiters || '0'),
          unitPrice: parseFloat(txn.pricePerLiter || '0'),
          totalPrice: parseFloat(txn.lineTotal || '0'),
        })) : cart.map(item => ({
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
        vehicleNumber: undefined, // Not applicable for grouped fuel sales
        customerName: activeTab === 'fuel'
          ? `${fuelCustomerGroups.length} customer(s)`
          : selectedCustomer?.name,
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

      const itemsText = activeTab === 'fuel' && fuelTransactions.length > 0
        ? `${queuedSaleIds.length} sale(s) queued (${fuelTransactions.length} transactions)`
        : `${cart.length} item(s)`;

      toast({ title: 'Sale completed', description: `${formatCurrency(totalAmount)} - ${itemsText}`, duration: 5000 });
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
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Point of Sale</h1>
          <p className="text-xs text-muted-foreground">Fuel and non-fuel sales</p>
        </div>
        <SyncStatus />
      </div>

      {!navigator.onLine && (
        <div className="flex items-center gap-2 rounded-md bg-yellow-50 dark:bg-yellow-900/20 p-3 text-sm text-yellow-800 dark:text-yellow-200">
          <WifiOff className="h-4 w-4" />
          Offline mode - sales will be saved locally and synced when back online
        </div>
      )}

      {/* Liters Counter - PMG & HSD Available */}
      <Card className="bg-gradient-to-r from-blue-50 to-green-50 dark:from-blue-950 dark:to-green-950">
        <CardContent className="pt-4 pb-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="text-center">
              <p className="text-xs text-muted-foreground">PMG</p>
              <p className="text-2xl font-bold text-blue-600">{litersData?.pmg_sold?.toLocaleString() || 0}</p>
              <p className="text-xs text-muted-foreground">L</p>
            </div>
            <div className="text-center border-l">
              <p className="text-xs text-muted-foreground">HSD</p>
              <p className="text-2xl font-bold text-green-600">{litersData?.hsd_sold?.toLocaleString() || 0}</p>
              <p className="text-xs text-muted-foreground">L</p>
            </div>
          </div>
        </CardContent>
      </Card>

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
            {/* Left: Fuel Transactions (2 cols) */}
            <div className="lg:col-span-2 space-y-4">
              {/* Add Customer Group Button */}
              <Card>
                <CardContent className="pt-6">
                  <Button
                    onClick={() => setIsAddFuelGroupOpen(true)}
                    variant="outline"
                    className="w-full border-dashed border-2 h-auto py-4"
                  >
                    <Users className="mr-2 h-5 w-5" />
                    Add Customer (Fuel Sale)
                  </Button>
                </CardContent>
              </Card>

              {/* Customer Groups Accordion */}
              {fuelCustomerGroups.length > 0 && (
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle>Fuel Transactions</CardTitle>
                      <Badge variant="secondary">{fuelTransactions.length} row{fuelTransactions.length !== 1 ? 's' : ''}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <Accordion
                      type="multiple"
                      value={openFuelAccordionItems}
                      onValueChange={setOpenFuelAccordionItems}
                      className="space-y-2"
                    >
                      {fuelCustomerGroups.map((group) => (
                        <AccordionItem
                          key={group.customerId}
                          value={group.customerId}
                          className="border rounded-lg"
                        >
                          <AccordionTrigger className="hover:no-underline px-4 py-3">
                            <div className="flex items-center justify-between w-full pr-4">
                              <div className="flex items-center gap-3">
                                <span className="font-semibold text-base">{group.customerName}</span>
                                <Badge variant="outline">{group.txns.length} transaction{group.txns.length !== 1 ? 's' : ''}</Badge>
                              </div>
                              <span className="text-sm font-medium text-green-600">
                                {formatCurrency(group.total)}
                              </span>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="px-4 pb-4">
                            <div className="space-y-3 mt-2">
                              {group.indices.map((globalIdx) => {
                                const txn = fuelTransactions[globalIdx];
                                const showBank = txn.paymentMethod === 'credit_card' || txn.paymentMethod === 'bank_card';
                                return (
                                  <div key={txn.id} className="flex gap-2 items-start p-2 rounded border bg-muted/30">
                                    {/* Vehicle # */}
                                    <div className="w-32">
                                      <Input
                                        placeholder="Vehicle#"
                                        value={txn.vehicleNumber}
                                        onChange={(e) => updateFuelTransaction(globalIdx, 'vehicleNumber', e.target.value)}
                                        className="h-8 text-xs"
                                      />
                                    </div>

                                    {/* Slip # */}
                                    <div className="w-28">
                                      <Input
                                        placeholder="Slip#"
                                        value={txn.slipNumber}
                                        onChange={(e) => updateFuelTransaction(globalIdx, 'slipNumber', e.target.value)}
                                        className="h-8 text-xs"
                                      />
                                    </div>

                                    {/* Payment Method */}
                                    <div className="w-36">
                                      <Select
                                        value={txn.paymentMethod}
                                        onValueChange={(v) => {
                                          updateFuelTransaction(globalIdx, 'paymentMethod', v as PaymentMethod);
                                          if (v !== 'credit_card' && v !== 'bank_card') {
                                            updateFuelTransaction(globalIdx, 'bankId', '');
                                          }
                                        }}
                                      >
                                        <SelectTrigger className="h-8 text-xs">
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="cash">Cash</SelectItem>
                                          <SelectItem value="credit_card">Credit Card</SelectItem>
                                          <SelectItem value="bank_card">Bank Card</SelectItem>
                                          <SelectItem value="pso_card">PSO Card</SelectItem>
                                          <SelectItem value="credit_customer">Credit Customer</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>

                                    {/* Bank (conditional) */}
                                    {showBank && (
                                      <div className="w-36">
                                        <Select
                                          value={txn.bankId}
                                          onValueChange={(v) => updateFuelTransaction(globalIdx, 'bankId', v)}
                                        >
                                          <SelectTrigger className="h-8 text-xs">
                                            <SelectValue placeholder="Bank *" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            {banks.length > 0 ? (
                                              banks.map((bank: any) => (
                                                <SelectItem key={bank.id} value={bank.id}>
                                                  {bank.name}
                                                </SelectItem>
                                              ))
                                            ) : (
                                              <SelectItem value="__no_banks__" disabled>
                                                No banks available
                                              </SelectItem>
                                            )}
                                          </SelectContent>
                                        </Select>
                                      </div>
                                    )}

                                    {/* Fuel Type */}
                                    <div className="w-28">
                                      <Select
                                        value={txn.fuelTypeId}
                                        onValueChange={(v) => updateFuelTransaction(globalIdx, 'fuelTypeId', v)}
                                      >
                                        <SelectTrigger className="h-8 text-xs">
                                          <SelectValue placeholder="Fuel" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {fuelTypes?.map(ft => (
                                            <SelectItem key={ft.id} value={ft.id}>{ft.name}</SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>

                                    {/* Liters */}
                                    <div className="w-24">
                                      <Input
                                        type="number"
                                        step="0.01"
                                        placeholder="Liters"
                                        value={txn.quantityLiters}
                                        onChange={(e) => updateFuelTransaction(globalIdx, 'quantityLiters', e.target.value)}
                                        className="h-8 text-xs"
                                      />
                                    </div>

                                    {/* Price/L (read-only) */}
                                    <div className="w-20">
                                      <Input
                                        value={txn.pricePerLiter}
                                        readOnly
                                        className="h-8 text-xs bg-muted"
                                        title="Price per liter"
                                      />
                                    </div>

                                    {/* Total (read-only) */}
                                    <div className="w-24">
                                      <Input
                                        value={txn.lineTotal}
                                        readOnly
                                        className="h-8 text-xs bg-muted font-semibold"
                                        title="Total"
                                      />
                                    </div>

                                    {/* Delete */}
                                    <div className="flex-shrink-0">
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        onClick={() => removeFuelTransaction(globalIdx)}
                                        className="h-8 w-8"
                                      >
                                        <Trash2 className="h-4 w-4 text-red-500" />
                                      </Button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="flex justify-end gap-2 mt-3">
                              <Button size="sm" variant="outline" onClick={() => duplicateLastFuelInGroup(group.indices)}>
                                <Copy className="h-3 w-3 mr-1" /> Duplicate Last
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => addFuelTransactionToCustomer(group.customerId, group.customerName)}>
                                <Plus className="h-3 w-3 mr-1" /> Add Row
                              </Button>
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  </CardContent>
                </Card>
              )}
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

      {/* Today's Posted Sales - Compact secondary section */}
      {todaysSalesData && todaysSalesData.count > 0 && (
        <Card className="bg-muted/30">
          <CardHeader className="py-2 px-4">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>Today's Posted Sales</span>
              <Badge variant="secondary" className="text-xs">{todaysSalesData.count}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="py-2 px-4">
            <div className="space-y-1">
              {todaysSalesData.sales.slice(0, 2).map((sale: any) => (
                <div key={sale.id} className="flex items-center justify-between text-xs p-1 rounded bg-background/50">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {sale.saleType === 'fuel'
                        ? `${sale.items[0]?.fuelType} ${sale.items[0]?.quantity}L`
                        : `${sale.items[0]?.product}`
                      }
                    </p>
                    {sale.customer && (
                      <p className="text-muted-foreground truncate">{sale.customer.name}</p>
                    )}
                  </div>
                  <div className="text-right ml-2 flex-shrink-0">
                    <p className="font-semibold">{formatCurrency(sale.totalAmount)}</p>
                  </div>
                </div>
              ))}
            </div>
            {todaysSalesData.count > 2 && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full mt-2 h-8 text-xs"
                onClick={() => navigate('/sales')}
              >
                View all {todaysSalesData.count} sales →
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Add Fuel Customer Group Dialog */}
      <Dialog open={isAddFuelGroupOpen} onOpenChange={(open) => {
        setIsAddFuelGroupOpen(open);
        if (!open) setFuelCustomerSearchQuery('');
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Select Customer for Fuel Sale</DialogTitle>
            <DialogDescription>Choose a customer to add fuel transactions</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Search Customer</Label>
              <Input
                placeholder="Search by name..."
                value={fuelCustomerSearchQuery}
                onChange={(e) => setFuelCustomerSearchQuery(e.target.value)}
                autoFocus
              />
            </div>
            <div className="max-h-[300px] overflow-y-auto space-y-1">
              {customers
                .filter(c =>
                  !fuelCustomerSearchQuery ||
                  c.name.toLowerCase().includes(fuelCustomerSearchQuery.toLowerCase())
                )
                .slice(0, 20)
                .map(c => (
                  <Button
                    key={c.id}
                    variant="ghost"
                    className="w-full justify-start text-left"
                    onClick={() => addFuelCustomerGroup(c.id, c.name)}
                  >
                    <Users className="h-4 w-4 mr-2" />
                    <div>
                      <div className="font-medium">{c.name}</div>
                      {c.phone && <div className="text-xs text-muted-foreground">{c.phone}</div>}
                    </div>
                  </Button>
                ))}
            </div>
            <div className="border-t pt-2">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setIsAddFuelGroupOpen(false);
                  setShowAddFuelCustomerDialog(true);
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                Create New Customer
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddFuelGroupOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create New Fuel Customer Dialog */}
      <Dialog open={showAddFuelCustomerDialog} onOpenChange={setShowAddFuelCustomerDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Customer</DialogTitle>
            <DialogDescription>Add a new customer for fuel sale</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Full Name *</Label>
              <Input
                placeholder="Customer name"
                value={newFuelCustomer.name}
                onChange={(e) => setNewFuelCustomer({ ...newFuelCustomer, name: e.target.value })}
                autoFocus
              />
            </div>
            <div>
              <Label>Phone</Label>
              <Input
                placeholder="Phone number"
                value={newFuelCustomer.phone}
                onChange={(e) => setNewFuelCustomer({ ...newFuelCustomer, phone: e.target.value })}
              />
            </div>
            <div>
              <Label>Email</Label>
              <Input
                placeholder="Email address"
                value={newFuelCustomer.email}
                onChange={(e) => setNewFuelCustomer({ ...newFuelCustomer, email: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddFuelCustomerDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddNewFuelCustomer} disabled={isSubmittingFuelCustomer}>
              {isSubmittingFuelCustomer ? 'Creating...' : 'Create Customer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
    const hasItems = activeTab === 'fuel' ? fuelTransactions.length > 0 : cart.length > 0;

    return (
      <div className="space-y-4">
        {/* Cart Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5" />
                Cart {activeTab === 'fuel' ? `(${fuelTransactions.length})` : `(${cart.length})`}
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
                {activeTab === 'fuel' ? 'Add customer group above' : 'Tap products to add them to cart'}
              </p>
            ) : activeTab === 'fuel' && fuelTransactions.length > 0 ? (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {fuelTransactions.map((txn) => (
                  <div key={txn.id} className="p-2 rounded-md bg-muted/50">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-sm font-medium">{txn.customerName}</p>
                        <p className="text-xs text-muted-foreground">
                          {txn.fuelTypeName} • {txn.vehicleNumber || 'No vehicle'} • {txn.paymentMethod.replace('_', ' ')}
                        </p>
                      </div>
                      <span className="text-sm font-bold">{formatCurrency(parseFloat(txn.lineTotal || '0'))}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {txn.quantityLiters}L × {formatCurrency(parseFloat(txn.pricePerLiter || '0'))}/L
                      {txn.slipNumber && ` • Slip: ${txn.slipNumber}`}
                    </div>
                  </div>
                ))}
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

        {/* Payment Section - Only for Product tab (Fuel uses row-level payment) */}
        {activeTab === 'product' && (
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
                  placeholder={customersLoading ? "Loading customers..." : "Walk-in customer"}
                  onCustomerAdded={() => refetchCustomers()}
                />
                {customersError && (
                  <Alert variant="destructive" className="py-2">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-xs">
                      Failed to load customers. <Button variant="link" size="sm" className="h-auto p-0 text-xs underline" onClick={() => refetchCustomers()}>Retry</Button>
                    </AlertDescription>
                  </Alert>
                )}
                {selectedCustomer && (
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <div className="flex justify-between">
                      <span>Balance:</span>
                      <span className="font-medium">{formatCurrency(currentBalance)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Limit:</span>
                      <span className="font-medium">{formatCurrency(selectedCustomer.creditLimit || 0)}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Credit Limit Warning */}
              {creditLimitExceeded && paymentMethod === 'credit_customer' && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    Credit limit exceeded! Current: {formatCurrency(currentBalance)}, Limit: {formatCurrency(selectedCustomer!.creditLimit || 0)}
                  </AlertDescription>
                </Alert>
              )}

              {/* Vehicle Number (for customer sales) */}
              {selectedCustomerId && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Vehicle Number (optional)</Label>
                  <Input
                    placeholder="e.g. ABC-1234"
                    value={vehicleNumber}
                    onChange={(e) => setVehicleNumber(e.target.value)}
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs">Payment Method</Label>
                <Select value={paymentMethod} onValueChange={(v) => {
                  setPaymentMethod(v as PaymentMethod);
                  if (v !== 'credit_card' && v !== 'bank_card') setSelectedBankId('');
                }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="credit_card">Credit Card</SelectItem>
                    <SelectItem value="bank_card">Bank Card</SelectItem>
                    <SelectItem value="pso_card">PSO Card</SelectItem>
                    <SelectItem value="credit_customer">Credit Customer</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Bank selector - only for card payments */}
              {(paymentMethod === 'credit_card' || paymentMethod === 'bank_card') && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Bank *</Label>
                  <Select value={selectedBankId} onValueChange={setSelectedBankId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select bank..." />
                    </SelectTrigger>
                    <SelectContent>
                      {banks.length > 0 ? (
                        banks.map((bank: any) => (
                          <SelectItem key={bank.id} value={bank.id}>
                            {bank.name}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="__no_banks__" disabled>
                          No banks available
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}

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
                disabled={submitting || !hasItems || ((paymentMethod === 'credit_card' || paymentMethod === 'bank_card') && !selectedBankId)}
                onClick={handleSubmit}
              >
                <Send className="mr-2 h-4 w-4" />
                {submitting ? 'Processing...' : `Complete Sale - ${formatCurrency(totalAmount)}`}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Fuel Tab: Submit Button Only */}
        {activeTab === 'fuel' && (
          <Card>
            <CardContent className="pt-6">
              <Button
                className="w-full"
                size="lg"
                disabled={submitting || !hasItems}
                onClick={handleSubmit}
              >
                <Send className="mr-2 h-4 w-4" />
                {submitting ? 'Processing...' : `Complete Sale - ${formatCurrency(totalAmount)}`}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }
}
