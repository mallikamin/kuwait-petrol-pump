import { useState, useMemo } from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { cn } from '@/utils/cn';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';

export interface ProductOption {
  id: string;
  name: string;
  sku?: string;
  category?: string;
}

interface ProductSelectorProps {
  products: ProductOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  allLabel?: string;
  disabled?: boolean;
}

/**
 * Searchable product picker. Mirrors customer-selector.tsx — popover-based with
 * client-side filtering against the supplied list. The `ALL` sentinel value is
 * used so callers can distinguish "no filter" from "empty selection".
 */
export const ALL_PRODUCTS_VALUE = 'ALL';

export function ProductSelector({
  products,
  value,
  onChange,
  placeholder = 'Select product...',
  allLabel = 'All products',
  disabled = false,
}: ProductSelectorProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return products;
    const q = searchQuery.toLowerCase();
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.sku && p.sku.toLowerCase().includes(q)) ||
        (p.category && p.category.toLowerCase().includes(q))
    );
  }, [products, searchQuery]);

  const selectedProduct = products.find((p) => p.id === value);
  const triggerLabel =
    value === ALL_PRODUCTS_VALUE || !value
      ? allLabel
      : selectedProduct?.name || placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'w-full justify-between',
            (!value || value === ALL_PRODUCTS_VALUE) && 'text-muted-foreground'
          )}
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, SKU, category..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
              autoFocus
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {filteredProducts.length} of {products.length} products
          </p>
        </div>
        <div className="max-h-60 overflow-y-auto py-1">
          <button
            type="button"
            onClick={() => {
              onChange(ALL_PRODUCTS_VALUE);
              setOpen(false);
              setSearchQuery('');
            }}
            className={cn(
              'flex w-full items-center px-3 py-2 text-sm hover:bg-accent',
              (value === ALL_PRODUCTS_VALUE || !value) && 'bg-accent/50'
            )}
          >
            <Check
              className={cn(
                'mr-2 h-4 w-4',
                value === ALL_PRODUCTS_VALUE || !value ? 'opacity-100' : 'opacity-0'
              )}
            />
            {allLabel}
          </button>
          {filteredProducts.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                onChange(p.id);
                setOpen(false);
                setSearchQuery('');
              }}
              className={cn(
                'flex w-full items-start px-3 py-2 text-sm hover:bg-accent text-left',
                value === p.id && 'bg-accent/50'
              )}
            >
              <Check
                className={cn(
                  'mr-2 mt-0.5 h-4 w-4 shrink-0',
                  value === p.id ? 'opacity-100' : 'opacity-0'
                )}
              />
              <div className="flex flex-col">
                <span className="font-medium">{p.name}</span>
                {(p.sku || p.category) && (
                  <span className="text-xs text-muted-foreground">
                    {[p.sku, p.category].filter(Boolean).join(' · ')}
                  </span>
                )}
              </div>
            </button>
          ))}
          {filteredProducts.length === 0 && (
            <div className="px-3 py-4 text-sm text-muted-foreground text-center">
              No products match "{searchQuery}"
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
