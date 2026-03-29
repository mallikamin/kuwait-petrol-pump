import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Plus, Upload, RefreshCw } from 'lucide-react';
import { quickbooksApi } from '@/api/quickbooks';
import { toast } from 'sonner';
import type { QBEntityMapping, CreateMappingRequest } from '@/types/quickbooks';

interface MappingsPanelProps {
  userRole: string;
}

export function MappingsPanel({ userRole }: MappingsPanelProps) {
  const [mappings, setMappings] = useState<QBEntityMapping[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showBulk, setShowBulk] = useState(false);

  // Form state
  const [formData, setFormData] = useState<CreateMappingRequest>({
    entityType: 'customer',
    localId: '',
    localName: '',
    qbId: '',
    qbName: '',
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Bulk state
  const [bulkText, setBulkText] = useState('');
  const [bulkErrors, setBulkErrors] = useState<string[]>([]);

  const canEdit = userRole === 'admin' || userRole === 'manager';

  const fetchMappings = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await quickbooksApi.getMappings();
      setMappings(result.mappings);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to fetch mappings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMappings();
  }, []);

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};
    if (!formData.localId.trim()) errors.localId = 'Required';
    if (!formData.localName.trim()) errors.localName = 'Required';
    if (!formData.qbId.trim()) errors.qbId = 'Required';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    try {
      setSubmitting(true);
      await quickbooksApi.createMapping(formData);
      toast.success('Mapping created successfully');
      setFormData({
        entityType: 'customer',
        localId: '',
        localName: '',
        qbId: '',
        qbName: '',
      });
      setFormErrors({});
      setShowForm(false);
      await fetchMappings();
    } catch (err: any) {
      const message = err.response?.data?.error || 'Failed to create mapping';
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkImport = async () => {
    try {
      setSubmitting(true);
      setBulkErrors([]);

      const lines = bulkText.trim().split('\n');
      const mappings: CreateMappingRequest[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const parts = line.split(',').map((p) => p.trim());
        if (parts.length !== 5) {
          throw new Error(`Line ${i + 1}: Expected 5 comma-separated values`);
        }

        const [entityType, localId, localName, qbId, qbName] = parts;
        if (!['customer', 'item', 'payment_method'].includes(entityType)) {
          throw new Error(`Line ${i + 1}: Invalid entityType "${entityType}"`);
        }

        mappings.push({
          entityType: entityType as 'customer' | 'item' | 'payment_method',
          localId,
          localName,
          qbId,
          qbName,
        });
      }

      const result = await quickbooksApi.bulkCreateMappings({ mappings });
      const failedRows = result.results.filter((row) => !row.success);
      if (failedRows.length > 0) {
        const errors = failedRows.map(
          (row) => `${row.entityType}:${row.localId} - ${row.error || 'Unknown error'}`
        );
        setBulkErrors(errors);
        toast.warning(`${result.successCount} created, ${result.failureCount} errors`);
      } else {
        toast.success(`${result.successCount} mappings created`);
        setBulkText('');
        setShowBulk(false);
      }
      await fetchMappings();
    } catch (err: any) {
      const message = err.response?.data?.error || err.message || 'Failed to import mappings';
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  // Delete functionality not implemented in backend
  // const handleDelete = async (id: string) => {
  //   if (!confirm('Delete this mapping?')) return;
  //   try {
  //     await quickbooksApi.deleteMapping(id);
  //     toast.success('Mapping deleted');
  //     await fetchMappings();
  //   } catch (err: any) {
  //     const message = err.response?.data?.error || 'Failed to delete mapping';
  //     toast.error(message);
  //   }
  // };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Entity Mappings</CardTitle>
            <CardDescription>
              Map local entities to QuickBooks entities (Admin/Manager)
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={fetchMappings}
              disabled={loading}
              size="sm"
              variant="outline"
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            {canEdit && (
              <>
                <Button
                  onClick={() => setShowBulk(!showBulk)}
                  size="sm"
                  variant="outline"
                  className="gap-2"
                >
                  <Upload className="h-4 w-4" />
                  Bulk Import
                </Button>
                <Button onClick={() => setShowForm(!showForm)} size="sm" className="gap-2">
                  <Plus className="h-4 w-4" />
                  Add Mapping
                </Button>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="p-3 mb-4 bg-red-50 text-red-900 rounded-md text-sm">{error}</div>
        )}

        {/* Single Mapping Form */}
        {showForm && canEdit && (
          <form onSubmit={handleSubmit} className="space-y-4 mb-6 p-4 border rounded-md">
            <h3 className="font-medium">Create New Mapping</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="entityType">Entity Type</Label>
                <Select
                  value={formData.entityType}
                  onValueChange={(value: any) =>
                    setFormData({ ...formData, entityType: value })
                  }
                >
                  <SelectTrigger id="entityType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="customer">Customer</SelectItem>
                    <SelectItem value="item">Item</SelectItem>
                    <SelectItem value="payment_method">Payment Method</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="localId">Local Entity ID</Label>
                <Input
                  id="localId"
                  value={formData.localId}
                  onChange={(e) =>
                    setFormData({ ...formData, localId: e.target.value })
                  }
                  placeholder="e.g., walk-in, cash, PMG_ID"
                />
                {formErrors.localId && (
                  <p className="text-sm text-red-600">{formErrors.localId}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="localName">Local Name</Label>
                <Input
                  id="localName"
                  value={formData.localName}
                  onChange={(e) => setFormData({ ...formData, localName: e.target.value })}
                  placeholder="e.g., Walk-in Customer"
                />
                {formErrors.localName && (
                  <p className="text-sm text-red-600">{formErrors.localName}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="qbId">QuickBooks Entity ID</Label>
                <Input
                  id="qbId"
                  value={formData.qbId}
                  onChange={(e) => setFormData({ ...formData, qbId: e.target.value })}
                  placeholder="e.g., 123456789"
                />
                {formErrors.qbId && (
                  <p className="text-sm text-red-600">{formErrors.qbId}</p>
                )}
              </div>
              <div className="space-y-2 col-span-2">
                <Label htmlFor="qbName">QuickBooks Name</Label>
                <Input
                  id="qbName"
                  value={formData.qbName}
                  onChange={(e) => setFormData({ ...formData, qbName: e.target.value })}
                  placeholder="e.g., Walk-in Customer"
                />
                {formErrors.qbName && (
                  <p className="text-sm text-red-600">{formErrors.qbName}</p>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowForm(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Creating...' : 'Create Mapping'}
              </Button>
            </div>
          </form>
        )}

        {/* Bulk Import Form */}
        {showBulk && canEdit && (
          <div className="space-y-4 mb-6 p-4 border rounded-md">
            <h3 className="font-medium">Bulk Import Mappings</h3>
            <p className="text-sm text-muted-foreground">
              Format: entityType,localId,localName,qbId,qbName (one per line)
            </p>
            <textarea
              className="w-full p-2 border rounded-md font-mono text-sm min-h-[200px]"
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder="customer,walk-in,Walk-in Customer,123,Walk-in Customer&#10;payment_method,cash,Cash,456,Cash&#10;item,PMG_ID,Petrol,789,Petrol"
            />
            {bulkErrors.length > 0 && (
              <div className="p-3 bg-red-50 text-red-900 rounded-md text-sm space-y-1">
                <p className="font-medium">Errors:</p>
                <ul className="list-disc list-inside">
                  {bulkErrors.map((err, idx) => (
                    <li key={idx}>{err}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowBulk(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button onClick={handleBulkImport} disabled={submitting || !bulkText.trim()}>
                {submitting ? 'Importing...' : 'Import'}
              </Button>
            </div>
          </div>
        )}

        {/* Mappings List */}
        {mappings.length === 0 && !loading ? (
          <p className="text-sm text-muted-foreground">
            No mappings found. {canEdit && 'Click "Add Mapping" to create one.'}
          </p>
        ) : (
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left p-2">Type</th>
                  <th className="text-left p-2">Local Entity</th>
                  <th className="text-left p-2">QuickBooks Entity</th>
                  <th className="text-left p-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((mapping) => (
                  <tr key={mapping.id} className="border-t">
                    <td className="p-2">
                      <Badge variant="outline">{mapping.entityType}</Badge>
                    </td>
                    <td className="p-2">
                      <div>
                        <div className="font-medium">{mapping.localName}</div>
                        <div className="text-xs text-muted-foreground">
                          {mapping.localId}
                        </div>
                      </div>
                    </td>
                    <td className="p-2">
                      <div>
                        <div className="font-medium">{mapping.qbName}</div>
                        <div className="text-xs text-muted-foreground">
                          {mapping.qbId}
                        </div>
                      </div>
                    </td>
                    <td className="p-2 text-muted-foreground">
                      {new Date(mapping.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
