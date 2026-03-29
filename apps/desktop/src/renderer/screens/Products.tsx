import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { productsApi } from '../api/endpoints';
import { useAppStore } from '../store/appStore';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { formatCurrency } from '../utils/format';
import { toast } from 'sonner';
import { Package, Plus, Search, Edit, AlertTriangle } from 'lucide-react';
import type { Product, StockLevel } from '@shared/types';

export const Products: React.FC = () => {
  const queryClient = useQueryClient();
  const { currentBranch } = useAppStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [showLowStock, setShowLowStock] = useState(false);

  const [formData, setFormData] = useState({
    sku: '',
    name: '',
    category: '',
    barcode: '',
    unitPrice: '',
    costPrice: '',
    lowStockThreshold: '',
  });

  // Fetch products
  const { data: productsData, isLoading } = useQuery({
    queryKey: ['products', searchQuery],
    queryFn: () =>
      productsApi.getAll({
        search: searchQuery || undefined,
        isActive: true,
        limit: 50,
      }),
  });

  // Fetch low stock
  const { data: lowStockData } = useQuery({
    queryKey: ['low-stock', currentBranch?.id],
    queryFn: () => productsApi.getLowStock(currentBranch?.id),
    enabled: !!currentBranch && showLowStock,
  });

  // Fetch categories
  const { data: categoriesData } = useQuery({
    queryKey: ['categories'],
    queryFn: () => productsApi.getCategories(),
  });

  const products = productsData?.data.items || [];
  const lowStockProducts = lowStockData?.data || [];
  const categories = categoriesData?.data || [];

  // Create product mutation
  const createProductMutation = useMutation({
    mutationFn: (data: any) => productsApi.create(data),
    onSuccess: () => {
      toast.success('Product created successfully');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setShowAddForm(false);
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to create product');
    },
  });

  // Update product mutation
  const updateProductMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      productsApi.update(id, data),
    onSuccess: () => {
      toast.success('Product updated successfully');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setSelectedProduct(null);
      resetForm();
      setShowAddForm(false);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to update product');
    },
  });

  const resetForm = () => {
    setFormData({
      sku: '',
      name: '',
      category: '',
      barcode: '',
      unitPrice: '',
      costPrice: '',
      lowStockThreshold: '',
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const data = {
      sku: formData.sku,
      name: formData.name,
      category: formData.category,
      barcode: formData.barcode || undefined,
      unitPrice: parseFloat(formData.unitPrice),
      costPrice: formData.costPrice ? parseFloat(formData.costPrice) : undefined,
      lowStockThreshold: formData.lowStockThreshold
        ? parseInt(formData.lowStockThreshold)
        : undefined,
    };

    if (selectedProduct) {
      updateProductMutation.mutate({ id: selectedProduct.id, data });
    } else {
      createProductMutation.mutate(data);
    }
  };

  const handleEdit = (product: Product) => {
    setSelectedProduct(product);
    setFormData({
      sku: product.sku,
      name: product.name,
      category: product.category,
      barcode: product.barcode || '',
      unitPrice: product.unitPrice,
      costPrice: product.costPrice || '',
      lowStockThreshold: product.lowStockThreshold?.toString() || '',
    });
    setShowAddForm(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Products & Inventory</h1>
          <p className="mt-1 text-sm text-slate-600">Manage product catalog and stock levels</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setShowLowStock(!showLowStock)}
          >
            <AlertTriangle className="mr-2 h-4 w-4" />
            Low Stock
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setShowAddForm(true);
              setSelectedProduct(null);
              resetForm();
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Product
          </Button>
        </div>
      </div>

      {/* Low Stock Alert */}
      {showLowStock && lowStockProducts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-orange-600">
              <AlertTriangle className="h-5 w-5" />
              Low Stock Products ({lowStockProducts.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2">
              {lowStockProducts.map((stock: StockLevel) => (
                <div
                  key={stock.id}
                  className="rounded-lg border border-orange-200 bg-orange-50 p-3"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-slate-900">
                        {stock.product.name}
                      </p>
                      <p className="text-sm text-slate-600">SKU: {stock.product.sku}</p>
                    </div>
                    <span className="rounded bg-orange-600 px-2 py-1 text-sm font-semibold text-white">
                      {stock.quantity}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Product List */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Product Catalog
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Search */}
            <div className="mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 h-5 w-5 text-slate-400" />
                <Input
                  placeholder="Search by SKU, name, or barcode..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* List */}
            <div className="space-y-3">
              {isLoading && <p className="text-sm text-slate-500">Loading...</p>}

              {!isLoading && products.length === 0 && (
                <p className="text-sm text-slate-500">No products found</p>
              )}

              {products.map((product: Product) => (
                <div
                  key={product.id}
                  className="flex items-center justify-between rounded-lg border border-slate-200 p-4 hover:bg-slate-50"
                >
                  <div className="flex-1">
                    <p className="font-semibold text-slate-900">{product.name}</p>
                    <div className="mt-1 flex items-center gap-4 text-sm text-slate-600">
                      <span>SKU: {product.sku}</span>
                      <span className="rounded bg-slate-100 px-2 py-0.5">
                        {product.category}
                      </span>
                      {product.barcode && <span>Barcode: {product.barcode}</span>}
                    </div>
                    <div className="mt-2 flex items-center gap-4">
                      <span className="text-lg font-semibold text-slate-900">
                        {formatCurrency(product.unitPrice)}
                      </span>
                      {product.costPrice && (
                        <span className="text-sm text-slate-500">
                          Cost: {formatCurrency(product.costPrice)}
                        </span>
                      )}
                      {product.lowStockThreshold && (
                        <span className="text-sm text-slate-500">
                          Low Stock: {product.lowStockThreshold}
                        </span>
                      )}
                    </div>
                  </div>

                  <Button size="sm" variant="outline" onClick={() => handleEdit(product)}>
                    <Edit className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Add/Edit Form */}
        {showAddForm && (
          <Card>
            <CardHeader>
              <CardTitle>
                {selectedProduct ? 'Edit Product' : 'Add New Product'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <Input
                  label="SKU *"
                  value={formData.sku}
                  onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                  placeholder="ENG-OIL-001"
                  required
                />

                <Input
                  label="Name *"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Engine Oil 5W-30"
                  required
                />

                <Input
                  label="Category *"
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  placeholder="Lubricants"
                  required
                />

                <Input
                  label="Barcode"
                  value={formData.barcode}
                  onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                  placeholder="123456789012"
                />

                <Input
                  label="Unit Price (PKR) *"
                  type="number"
                  step="0.001"
                  value={formData.unitPrice}
                  onChange={(e) =>
                    setFormData({ ...formData, unitPrice: e.target.value })
                  }
                  placeholder="250.000"
                  required
                />

                <Input
                  label="Cost Price (PKR)"
                  type="number"
                  step="0.001"
                  value={formData.costPrice}
                  onChange={(e) =>
                    setFormData({ ...formData, costPrice: e.target.value })
                  }
                  placeholder="150.000"
                />

                <Input
                  label="Low Stock Threshold"
                  type="number"
                  value={formData.lowStockThreshold}
                  onChange={(e) =>
                    setFormData({ ...formData, lowStockThreshold: e.target.value })
                  }
                  placeholder="10"
                />

                <div className="flex gap-2">
                  <Button
                    type="submit"
                    variant="primary"
                    className="flex-1"
                    isLoading={
                      createProductMutation.isPending || updateProductMutation.isPending
                    }
                  >
                    {selectedProduct ? 'Update' : 'Create'} Product
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowAddForm(false);
                      setSelectedProduct(null);
                      resetForm();
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};
