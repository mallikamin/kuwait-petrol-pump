import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Plus, Upload, RefreshCw, Wand2, CheckCircle, AlertCircle, XCircle } from 'lucide-react';
import { quickbooksApi } from '@/api/quickbooks';
import { toast } from 'sonner';
import type { QBEntityMapping, CreateMappingRequest, MatchResult } from '@/types/quickbooks';

interface MappingsPanelProps {
  userRole: string;
}

export function MappingsPanel({ userRole }: MappingsPanelProps) {
  const [mappings, setMappings] = useState<QBEntityMapping[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [showAutoMatch, setShowAutoMatch] = useState(false);
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [applyingMatch, setApplyingMatch] = useState(false);
  const [qbTokenExpired, setQbTokenExpired] = useState(false);
  const [activeTab, setActiveTab] = useState<'accounts' | 'customers' | 'items' | 'banks'>('accounts');

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

  const handleRunAutoMatch = async () => {
    try {
      setMatchLoading(true);
      setQbTokenExpired(false);
      const result = await quickbooksApi.runMatch();
      setMatchResult(result.result);
      setShowAutoMatch(true);
      toast.success(`Auto-match complete: ${result.result.healthGrade} grade`);
    } catch (err: any) {
      if (err.response?.status === 401 || err.response?.data?.error?.includes('token')) {
        setQbTokenExpired(true);
        toast.error('QuickBooks token expired. Please reconnect.');
      } else {
        toast.error(err.response?.data?.error || 'Failed to run auto-match');
      }
    } finally {
      setMatchLoading(false);
    }
  };

  const handleDecisionChange = (needKey: string, decision: 'use_existing' | 'create_new', accountId?: string, accountName?: string) => {
    if (!matchResult) return;

    const updatedItems = matchResult.accountItems.map((item) =>
      item.needKey === needKey
        ? { ...item, decision, decisionAccountId: accountId || null, decisionAccountName: accountName || null }
        : item
    );

    setMatchResult({ ...matchResult, accountItems: updatedItems });
  };

  const handleEntityDecisionChange = (
    localId: string,
    entityType: 'customer' | 'item' | 'bank',
    decision: 'use_existing' | 'create_new',
    qbEntityId?: string,
    qbEntityName?: string
  ) => {
    if (!matchResult) return;

    const itemsKey = entityType === 'customer' ? 'customerItems' : entityType === 'item' ? 'itemItems' : 'bankItems';
    const updatedItems = matchResult[itemsKey].map((item) =>
      item.localId === localId
        ? { ...item, decision, decisionEntityId: qbEntityId || null, decisionEntityName: qbEntityName || null }
        : item
    );

    setMatchResult({ ...matchResult, [itemsKey]: updatedItems });
  };

  const handleApplyMatch = async () => {
    if (!matchResult) return;

    try {
      setApplyingMatch(true);

      // Apply accounts
      const accountDecisions = matchResult.accountItems
        .filter((item) => item.decision)
        .map((item) => ({
          needKey: item.needKey,
          decision: item.decision!,
          accountId: item.decisionAccountId || undefined,
          accountName: item.decisionAccountName || undefined,
        }));

      if (accountDecisions.length > 0) {
        await quickbooksApi.updateMatchDecisions(matchResult.id, accountDecisions);
        await quickbooksApi.applyMatch(matchResult.id);
      }

      // Apply customers
      const customerDecisions = matchResult.customerItems
        .filter((item) => item.decision)
        .map((item) => ({
          localId: item.localId,
          decision: item.decision!,
          qbEntityId: item.decisionEntityId || undefined,
          qbEntityName: item.decisionEntityName || undefined,
        }));

      if (customerDecisions.length > 0) {
        await quickbooksApi.updateEntityDecisions(matchResult.id, 'customer', customerDecisions);
        await quickbooksApi.applyEntityMappings(matchResult.id, 'customer');
      }

      // Apply items
      const itemDecisions = matchResult.itemItems
        .filter((item) => item.decision)
        .map((item) => ({
          localId: item.localId,
          decision: item.decision!,
          qbEntityId: item.decisionEntityId || undefined,
          qbEntityName: item.decisionEntityName || undefined,
        }));

      if (itemDecisions.length > 0) {
        await quickbooksApi.updateEntityDecisions(matchResult.id, 'item', itemDecisions);
        await quickbooksApi.applyEntityMappings(matchResult.id, 'item');
      }

      // Apply banks
      const bankDecisions = matchResult.bankItems
        .filter((item) => item.decision)
        .map((item) => ({
          localId: item.localId,
          decision: item.decision!,
          qbEntityId: item.decisionEntityId || undefined,
          qbEntityName: item.decisionEntityName || undefined,
        }));

      if (bankDecisions.length > 0) {
        await quickbooksApi.updateEntityDecisions(matchResult.id, 'bank', bankDecisions);
        await quickbooksApi.applyEntityMappings(matchResult.id, 'bank');
      }

      const totalMappings =
        accountDecisions.length + customerDecisions.length + itemDecisions.length + bankDecisions.length;
      toast.success(`Applied ${totalMappings} mappings`);
      setShowAutoMatch(false);
      setMatchResult(null);
      await fetchMappings();
    } catch (err: any) {
      if (err.response?.status === 401 || err.response?.data?.error?.includes('token')) {
        setQbTokenExpired(true);
        toast.error('QuickBooks token expired. Please reconnect.');
      } else {
        toast.error(err.response?.data?.error || 'Failed to apply match');
      }
    } finally {
      setApplyingMatch(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'matched':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'candidates':
        return <AlertCircle className="h-4 w-4 text-yellow-600" />;
      case 'unmatched':
        return <XCircle className="h-4 w-4 text-red-600" />;
      default:
        return null;
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
                  onClick={handleRunAutoMatch}
                  disabled={matchLoading}
                  size="sm"
                  variant="outline"
                  className="gap-2"
                >
                  <Wand2 className={`h-4 w-4 ${matchLoading ? 'animate-spin' : ''}`} />
                  Auto-Match
                </Button>
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

        {qbTokenExpired && (
          <div className="p-4 mb-4 bg-yellow-50 border border-yellow-200 rounded-md">
            <p className="text-sm font-medium text-yellow-900 mb-2">QuickBooks Token Expired</p>
            <p className="text-sm text-yellow-700 mb-3">
              Your QuickBooks connection has expired. Please reconnect to continue.
            </p>
            <Button
              onClick={async () => {
                try {
                  const result = await quickbooksApi.initiateOAuth();
                  window.open(result.authorizationUrl, '_blank');
                } catch (err: any) {
                  toast.error('Failed to initiate OAuth');
                }
              }}
              size="sm"
              variant="default"
            >
              Reconnect QuickBooks
            </Button>
          </div>
        )}

        {/* Auto-Match Results */}
        {showAutoMatch && matchResult && (
          <div className="mb-6 p-4 border rounded-md space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-medium">Auto-Match Results</h3>
                <p className="text-sm text-muted-foreground">
                  Overall: <Badge>{matchResult.overallHealthGrade}</Badge> | Coverage: {matchResult.overallCoveragePct}%
                </p>
              </div>
              <Button
                onClick={() => setShowAutoMatch(false)}
                size="sm"
                variant="outline"
              >
                Close
              </Button>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 border-b">
              <button
                className={`px-4 py-2 border-b-2 transition-colors ${
                  activeTab === 'accounts' ? 'border-primary font-medium' : 'border-transparent text-muted-foreground'
                }`}
                onClick={() => setActiveTab('accounts')}
              >
                Accounts ({matchResult.accountsMatched}/{matchResult.accountsTotal})
              </button>
              <button
                className={`px-4 py-2 border-b-2 transition-colors ${
                  activeTab === 'customers' ? 'border-primary font-medium' : 'border-transparent text-muted-foreground'
                }`}
                onClick={() => setActiveTab('customers')}
              >
                Customers ({matchResult.customersMatched}/{matchResult.customersTotal})
              </button>
              <button
                className={`px-4 py-2 border-b-2 transition-colors ${
                  activeTab === 'items' ? 'border-primary font-medium' : 'border-transparent text-muted-foreground'
                }`}
                onClick={() => setActiveTab('items')}
              >
                Items ({matchResult.itemsMatched}/{matchResult.itemsTotal})
              </button>
              <button
                className={`px-4 py-2 border-b-2 transition-colors ${
                  activeTab === 'banks' ? 'border-primary font-medium' : 'border-transparent text-muted-foreground'
                }`}
                onClick={() => setActiveTab('banks')}
              >
                Banks ({matchResult.banksMatched}/{matchResult.banksTotal})
              </button>
            </div>

            {/* Accounts Tab */}
            {activeTab === 'accounts' && (
              <div className="space-y-2">
                {matchResult.accountItems.map((item) => (
                <div key={item.needKey} className="p-3 border rounded-md">
                  <div className="flex items-start gap-3">
                    {getStatusIcon(item.status)}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{item.needLabel}</span>
                          {item.required && <Badge variant="outline" className="text-xs">Required</Badge>}
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id={`needs-review-${item.needKey}`}
                            className="h-4 w-4 rounded border-gray-300"
                            checked={item.needsClientReview || false}
                            onChange={(e) => {
                              if (!matchResult) return;
                              const updatedItems = matchResult.accountItems.map((i) =>
                                i.needKey === item.needKey ? { ...i, needsClientReview: e.target.checked } : i
                              );
                              setMatchResult({ ...matchResult, accountItems: updatedItems });
                            }}
                          />
                          <Label htmlFor={`needs-review-${item.needKey}`} className="text-xs text-muted-foreground cursor-pointer">
                            Ask Client
                          </Label>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground">{item.needDescription}</p>

                      {item.bestMatch && (
                        <div className="mt-2 p-2 bg-muted rounded text-sm flex items-center justify-between gap-2">
                          <div className="flex-1">
                            <div className="font-medium">{item.bestMatch.qbAccountName}</div>
                            <div className="text-xs text-muted-foreground">
                              {item.bestMatch.qbAccountType} • Score: {(item.bestMatch.score * 100).toFixed(0)}%
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant={item.decisionAccountId === item.bestMatch?.qbAccountId ? "default" : "outline"}
                            className="h-7 text-xs"
                            onClick={() => {
                              if (!item.bestMatch) return;
                              handleDecisionChange(
                                item.needKey,
                                'use_existing',
                                item.bestMatch.qbAccountId,
                                item.bestMatch.qbAccountName
                              );
                            }}
                          >
                            {item.decisionAccountId === item.bestMatch?.qbAccountId ? 'Selected' : 'Accept'}
                          </Button>
                        </div>
                      )}

                      {item.candidates.length > 0 && (
                        <div className="mt-2">
                          <Label className="text-xs">All candidates ({item.candidates.length}):</Label>
                          <Select
                            value={item.decisionAccountId ?? ''}
                            onValueChange={(value) => {
                              const candidate = item.candidates.find((c) => c.qbAccountId === value);
                              if (candidate) {
                                handleDecisionChange(item.needKey, 'use_existing', value, candidate.qbAccountName);
                              }
                            }}
                          >
                            <SelectTrigger className="mt-1 h-8 text-xs">
                              <SelectValue placeholder="Select candidate...">
                                {item.decisionAccountId
                                  ? item.candidates.find(c => c.qbAccountId === item.decisionAccountId)?.qbAccountName || 'Selected'
                                  : 'Select candidate...'}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {item.candidates.map((candidate, idx) => (
                                <SelectItem key={candidate.qbAccountId || candidate.qbEntityId} value={candidate.qbAccountId || candidate.qbEntityId}>
                                  {idx === 0 && '⭐ '}{candidate.qbAccountName || candidate.qbEntityName} ({(candidate.score * 100).toFixed(0)}%)
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            )}

            {/* Entity Tabs */}
            {(activeTab === 'customers' || activeTab === 'items' || activeTab === 'banks') && (
              <div className="space-y-2">
                {(activeTab === 'customers'
                  ? matchResult.customerItems
                  : activeTab === 'items'
                  ? matchResult.itemItems
                  : matchResult.bankItems
                ).map((item) => (
                  <div key={item.localId} className="p-3 border rounded-md">
                    <div className="flex items-start gap-3">
                      {getStatusIcon(item.status)}
                      <div className="flex-1">
                        <div className="flex items-center gap-2 justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{item.localName}</span>
                            <Badge variant="outline" className="text-xs">{item.entityType}</Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              id={`needs-review-${item.localId}`}
                              className="h-4 w-4 rounded border-gray-300"
                              checked={item.needsClientReview || false}
                              onChange={(e) => {
                                if (!matchResult) return;
                                const itemsKey = item.entityType === 'customer' ? 'customerItems' : item.entityType === 'item' ? 'itemItems' : 'bankItems';
                                const updatedItems = matchResult[itemsKey].map((i) =>
                                  i.localId === item.localId ? { ...i, needsClientReview: e.target.checked } : i
                                );
                                setMatchResult({ ...matchResult, [itemsKey]: updatedItems });
                              }}
                            />
                            <Label htmlFor={`needs-review-${item.localId}`} className="text-xs text-muted-foreground cursor-pointer">
                              Ask Client
                            </Label>
                          </div>
                        </div>

                        {item.bestMatch && (
                          <div className="mt-2 p-2 bg-muted rounded text-sm flex items-center justify-between gap-2">
                            <div className="flex-1">
                              <div className="font-medium">{item.bestMatch.qbEntityName}</div>
                              <div className="text-xs text-muted-foreground">
                                Score: {(item.bestMatch.score * 100).toFixed(0)}%
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant={item.decisionEntityId === item.bestMatch?.qbEntityId ? "default" : "outline"}
                              className="h-7 text-xs"
                              onClick={() => {
                                if (!item.bestMatch) return;
                                handleEntityDecisionChange(
                                  item.localId,
                                  item.entityType,
                                  'use_existing',
                                  item.bestMatch.qbEntityId,
                                  item.bestMatch.qbEntityName
                                );
                              }}
                            >
                              {item.decisionEntityId === item.bestMatch?.qbEntityId ? 'Selected' : 'Accept'}
                            </Button>
                          </div>
                        )}

                        {item.candidates.length > 0 && (
                          <div className="mt-2">
                            <Label className="text-xs">All candidates ({item.candidates.length}):</Label>
                            <Select
                              value={item.decisionEntityId ?? ''}
                              onValueChange={(value) => {
                                console.log('[Dropdown] Selected value:', value);
                                const candidate = item.candidates.find((c) => c.qbEntityId === value);
                                console.log('[Dropdown] Found candidate:', candidate);
                                if (candidate) {
                                  console.log('[Dropdown] Updating decision for', item.localId, 'to', value);
                                  handleEntityDecisionChange(
                                    item.localId,
                                    item.entityType,
                                    'use_existing',
                                    value,
                                    candidate.qbEntityName
                                  );
                                }
                              }}
                            >
                              <SelectTrigger className="mt-1 h-8 text-xs">
                                <SelectValue placeholder="Select candidate...">
                                  {item.decisionEntityId
                                    ? item.candidates.find(c => c.qbEntityId === item.decisionEntityId)?.qbEntityName || 'Selected'
                                    : 'Select candidate...'}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                {item.candidates.map((candidate, idx) => (
                                  <SelectItem key={candidate.qbEntityId} value={candidate.qbEntityId}>
                                    {idx === 0 && '⭐ '}{candidate.qbEntityName} ({(candidate.score * 100).toFixed(0)}%)
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Mapping Status Summary */}
            <div className="pt-4 border-t space-y-4">
              <div className="text-sm font-semibold mb-3">Mapping Status Summary</div>

              {/* a) QB Entities Not Mapped */}
              <div className="p-3 bg-orange-50 border border-orange-200 rounded">
                <div className="text-sm font-medium mb-2 text-orange-900">⚠️ QB Entities Not Mapped to POS</div>
                <div className="space-y-1 text-xs">
                  <div>Accounts: {matchResult.unmappedQBAccounts?.length || 0} unmapped</div>
                  <div>Customers: {matchResult.unmappedQBCustomers?.length || 0} unmapped</div>
                  <div>Items: {matchResult.unmappedQBItems?.length || 0} unmapped</div>
                  <div>Banks: {matchResult.unmappedQBBanks?.length || 0} unmapped</div>
                </div>
                {(matchResult.unmappedQBAccounts?.length || 0) + (matchResult.unmappedQBCustomers?.length || 0) + (matchResult.unmappedQBItems?.length || 0) + (matchResult.unmappedQBBanks?.length || 0) > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-orange-700 hover:underline">Show details</summary>
                    <div className="mt-2 space-y-1 text-xs max-h-40 overflow-y-auto">
                      {matchResult.unmappedQBAccounts?.map((acc: any) => (
                        <div key={acc.qbAccountId} className="pl-2">• Account: {acc.qbAccountName}</div>
                      ))}
                      {matchResult.unmappedQBCustomers?.map((cust: any) => (
                        <div key={cust.id} className="pl-2">• Customer: {cust.name}</div>
                      ))}
                      {matchResult.unmappedQBItems?.map((item: any) => (
                        <div key={item.id} className="pl-2">• Item: {item.name}</div>
                      ))}
                      {matchResult.unmappedQBBanks?.map((bank: any) => (
                        <div key={bank.id} className="pl-2">• Bank: {bank.name}</div>
                      ))}
                    </div>
                  </details>
                )}
              </div>

              {/* b) POS Entities Not Mapped */}
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded">
                <div className="text-sm font-medium mb-2 text-yellow-900">⚠️ POS Entities Not Mapped to QB</div>
                <div className="space-y-1 text-xs">
                  <div>Accounts: {matchResult.accountItems.filter((i: any) => !i.decision).length} unmapped</div>
                  <div>Customers: {matchResult.customerItems.filter((i: any) => !i.decision).length} unmapped</div>
                  <div>Items: {matchResult.itemItems.filter((i: any) => !i.decision).length} unmapped</div>
                  <div>Banks: {matchResult.bankItems.filter((i: any) => !i.decision).length} unmapped</div>
                </div>
                {matchResult.accountItems.filter((i: any) => !i.decision).length + matchResult.customerItems.filter((i: any) => !i.decision).length + matchResult.itemItems.filter((i: any) => !i.decision).length + matchResult.bankItems.filter((i: any) => !i.decision).length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-yellow-700 hover:underline">Show details</summary>
                    <div className="mt-2 space-y-1 text-xs max-h-40 overflow-y-auto">
                      {matchResult.accountItems.filter((i: any) => !i.decision).map((item: any) => (
                        <div key={item.localId} className="pl-2">• Account: {item.localName}</div>
                      ))}
                      {matchResult.customerItems.filter((i: any) => !i.decision).map((item: any) => (
                        <div key={item.localId} className="pl-2">• Customer: {item.localName}</div>
                      ))}
                      {matchResult.itemItems.filter((i: any) => !i.decision).map((item: any) => (
                        <div key={item.localId} className="pl-2">• Item: {item.localName}</div>
                      ))}
                      {matchResult.bankItems.filter((i: any) => !i.decision).map((item: any) => (
                        <div key={item.localId} className="pl-2">• Bank: {item.localName}</div>
                      ))}
                    </div>
                  </details>
                )}
              </div>

              {/* c) Successful Mappings */}
              <div className="p-3 bg-green-50 border border-green-200 rounded">
                <div className="text-sm font-medium mb-2 text-green-900">✅ Successful Mappings (Auto-Matched)</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>Accounts: {matchResult.accountItems.filter((i: any) => i.decision && !i.needsClientReview).length} mapped</div>
                  <div>Customers: {matchResult.customerItems.filter((i: any) => i.decision && !i.needsClientReview).length} mapped</div>
                  <div>Items: {matchResult.itemItems.filter((i: any) => i.decision && !i.needsClientReview).length} mapped</div>
                  <div>Banks: {matchResult.bankItems.filter((i: any) => i.decision && !i.needsClientReview).length} mapped</div>
                </div>
              </div>

              {/* d) Needs Client Confirmation */}
              <div className="p-3 bg-purple-50 border border-purple-200 rounded">
                <div className="text-sm font-medium mb-2 text-purple-900">🔍 Needs Client Confirmation</div>
                <div className="space-y-1 text-xs">
                  <div>Total: {[...matchResult.accountItems, ...matchResult.customerItems, ...matchResult.itemItems, ...matchResult.bankItems].filter((i: any) => i.needsClientReview).length} marked</div>
                </div>
                {[...matchResult.accountItems, ...matchResult.customerItems, ...matchResult.itemItems, ...matchResult.bankItems].filter((i: any) => i.needsClientReview).length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-purple-700 hover:underline">Show details</summary>
                    <div className="mt-2 space-y-1 text-xs max-h-40 overflow-y-auto">
                      {[...matchResult.accountItems, ...matchResult.customerItems, ...matchResult.itemItems, ...matchResult.bankItems]
                        .filter((i: any) => i.needsClientReview)
                        .map((item: any) => (
                          <div key={item.localId} className="pl-2">
                            • {item.entityType}: {item.localName} → {item.decisionEntityName || 'No match'}
                          </div>
                        ))}
                    </div>
                  </details>
                )}
              </div>

              {/* Action Summary */}
              <div className="p-3 bg-blue-50 border border-blue-200 rounded">
                <div className="text-sm font-medium mb-2">Ready to Save:</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>Accounts: {matchResult.accountItems.filter((i: any) => i.decision).length} decisions</div>
                  <div>Customers: {matchResult.customerItems.filter((i: any) => i.decision).length} decisions</div>
                  <div>Items: {matchResult.itemItems.filter((i: any) => i.decision).length} decisions</div>
                  <div>Banks: {matchResult.bankItems.filter((i: any) => i.decision).length} decisions</div>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  onClick={() => setShowAutoMatch(false)}
                  variant="outline"
                  disabled={applyingMatch}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleApplyMatch}
                  disabled={applyingMatch}
                  size="lg"
                  className="px-8"
                >
                  {applyingMatch ? 'Saving...' : 'Save All Decisions'}
                </Button>
              </div>
            </div>
          </div>
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
