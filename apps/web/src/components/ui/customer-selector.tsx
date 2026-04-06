import { useState, useMemo } from 'react';
import { Check, ChevronsUpDown, Search, Plus, Loader2 } from 'lucide-react';
import { cn } from '@/utils/cn';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { customersApi } from '@/api';
import { toast } from 'sonner';

interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
}

interface CustomerSelectorProps {
  customers: Customer[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onCustomerAdded?: () => void;
}

export function CustomerSelector({ customers, value, onChange, placeholder = "Select customer...", onCustomerAdded }: CustomerSelectorProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', email: '' });

  const filteredCustomers = useMemo(() => {
    if (!searchQuery.trim()) return customers;

    const query = searchQuery.toLowerCase();
    return customers.filter(customer =>
      customer.name.toLowerCase().includes(query) ||
      (customer.phone && customer.phone.toLowerCase().includes(query)) ||
      (customer.email && customer.email.toLowerCase().includes(query))
    );
  }, [customers, searchQuery]);

  const selectedCustomer = customers.find(c => c.id === value);

  const handleAddCustomer = async () => {
    if (!newCustomer.name.trim()) {
      toast.error('Customer name is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await customersApi.create({
        name: newCustomer.name.trim(),
        phone: newCustomer.phone.trim() || undefined,
        email: newCustomer.email.trim() || undefined,
      });

      toast.success('Customer added successfully');
      setShowAddDialog(false);
      setNewCustomer({ name: '', phone: '', email: '' });

      // Notify parent to refresh customer list
      if (onCustomerAdded) {
        onCustomerAdded();
      }

      // Auto-select the newly created customer
      if (result && result.id) {
        onChange(result.id);
      }
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to add customer');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
        >
          {selectedCustomer ? (
            <span className="truncate">
              {selectedCustomer.name} {selectedCustomer.phone ? `(${selectedCustomer.phone})` : ''}
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <div className="p-2 border-b space-y-2">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, phone, or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => {
              setShowAddDialog(true);
              setOpen(false);
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add New Customer
          </Button>
        </div>
        <div className="max-h-[300px] overflow-y-auto">
          {/* Walk-in customer option */}
          <div
            onClick={() => {
              onChange('none');
              setOpen(false);
              setSearchQuery('');
            }}
            className={cn(
              "flex items-center px-3 py-2 cursor-pointer hover:bg-accent",
              value === 'none' && "bg-accent"
            )}
          >
            <Check
              className={cn(
                "mr-2 h-4 w-4",
                value === 'none' ? "opacity-100" : "opacity-0"
              )}
            />
            <span className="text-sm">Walk-in customer</span>
          </div>

          {filteredCustomers.length === 0 ? (
            <div className="px-3 py-4 text-sm text-center text-muted-foreground">
              No customers found.
            </div>
          ) : (
            filteredCustomers.map((customer) => (
              <div
                key={customer.id}
                onClick={() => {
                  onChange(customer.id);
                  setOpen(false);
                  setSearchQuery('');
                }}
                className={cn(
                  "flex items-center px-3 py-2 cursor-pointer hover:bg-accent",
                  value === customer.id && "bg-accent"
                )}
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4",
                    value === customer.id ? "opacity-100" : "opacity-0"
                  )}
                />
                <div className="flex-1">
                  <div className="text-sm font-medium">{customer.name}</div>
                  <div className="text-xs text-muted-foreground">{customer.phone || customer.email || 'No contact info'}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>

    {/* Add Customer Dialog */}
    <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add New Customer</DialogTitle>
          <DialogDescription>
            Enter customer details to create a new customer record.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="customer-name">Name *</Label>
            <Input
              id="customer-name"
              placeholder="Customer name"
              value={newCustomer.name}
              onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
              disabled={isSubmitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="customer-phone">Phone</Label>
            <Input
              id="customer-phone"
              placeholder="Phone number"
              value={newCustomer.phone}
              onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
              disabled={isSubmitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="customer-email">Email</Label>
            <Input
              id="customer-email"
              type="email"
              placeholder="Email address"
              value={newCustomer.email}
              onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
              disabled={isSubmitting}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowAddDialog(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleAddCustomer}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Adding...
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" />
                Add Customer
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
