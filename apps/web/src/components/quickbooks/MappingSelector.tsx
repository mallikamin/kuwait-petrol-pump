/**
 * Universal Mapping Selector Component
 * Reusable across auto-match rows and already-mapped edit flows
 * Handles POS + QB entity search with conflict detection
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { quickbooksApi } from '@/api/quickbooks';
import { toast } from 'sonner';

interface MappingSelectorProps {
  entityType: string;
  currentPosId?: string;
  currentQbId?: string;
  onSelect: (posId: string, qbId: string, qbName: string) => void;
  onClose: () => void;
  twoWayEdit?: boolean; // If true, allow editing both POS and QB sides
}

interface SearchResult {
  qbId?: string;
  localId?: string;
  qbName?: string;
  localName?: string;
  alreadyMapped?: boolean;
  mappedTo?: { localId?: string; localName?: string; qbId?: string; qbName?: string };
}

export function MappingSelector({
  entityType,
  currentPosId,
  currentQbId,
  onSelect,
  onClose,
  twoWayEdit = false,
}: MappingSelectorProps) {
  const [tab, setTab] = useState<'qb' | 'pos'>('qb'); // Which side to search
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPosId, setSelectedPosId] = useState(currentPosId || '');
  const [selectedQbId, setSelectedQbId] = useState(currentQbId || '');
  const [selectedQbName, setSelectedQbName] = useState('');
  const [showConflictWarning, setShowConflictWarning] = useState(false);
  const [conflictDetails, setConflictDetails] = useState<any>(null);

  const handleSearch = async (searchQuery: string) => {
    setQuery(searchQuery);
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }

    try {
      setLoading(true);
      if (tab === 'qb') {
        const result = await quickbooksApi.searchQbEntities(entityType, searchQuery);
        if (result.success) {
          setResults(result.results as any[]);
        }
      } else {
        const result = await quickbooksApi.searchPosEntities(entityType, searchQuery);
        if (result.success) {
          setResults(result.results as any[]);
        }
      }
    } catch (err: any) {
      toast.error('Search failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectQb = (result: SearchResult) => {
    if (result.alreadyMapped && result.mappedTo) {
      setShowConflictWarning(true);
      setConflictDetails({
        type: 'qb',
        qbId: result.qbId,
        qbName: result.qbName,
        mappedPosId: result.mappedTo.localId,
        mappedPosName: result.mappedTo.localName,
      });
      return;
    }

    setSelectedQbId(result.qbId || '');
    setSelectedQbName(result.qbName || '');
    if (!twoWayEdit) {
      onSelect(selectedPosId, result.qbId || '', result.qbName || '');
      onClose();
    }
  };

  const handleSelectPos = (result: SearchResult) => {
    if (result.alreadyMapped && result.mappedTo) {
      setShowConflictWarning(true);
      setConflictDetails({
        type: 'pos',
        posId: result.localId,
        posName: result.localName,
        mappedQbId: result.mappedTo.qbId,
        mappedQbName: result.mappedTo.qbName,
      });
      return;
    }

    setSelectedPosId(result.localId || '');
    if (twoWayEdit) {
      // In two-way edit, wait for QB selection too
      setTab('qb');
      setQuery('');
      setResults([]);
    } else {
      onSelect(result.localId || '', selectedQbId, selectedQbName);
      onClose();
    }
  };

  const handleConfirmSelection = () => {
    if (selectedPosId && selectedQbId) {
      onSelect(selectedPosId, selectedQbId, selectedQbName);
      onClose();
    } else {
      toast.error('Please select both POS and QB entities');
    }
  };

  const handleOverrideConflict = () => {
    if (conflictDetails.type === 'qb') {
      setSelectedQbId(conflictDetails.qbId);
      setSelectedQbName(conflictDetails.qbName);
    } else {
      setSelectedPosId(conflictDetails.posId);
    }
    setShowConflictWarning(false);
    setConflictDetails(null);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <Card className="w-full max-w-2xl max-h-96 overflow-y-auto">
        <CardHeader>
          <CardTitle>
            {twoWayEdit ? 'Map POS & QB Entity' : 'Find QB Entity'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {showConflictWarning ? (
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-md space-y-3">
              <div className="flex gap-2">
                <AlertCircle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium text-yellow-900">Conflict Detected</p>
                  {conflictDetails.type === 'qb' ? (
                    <p className="text-sm text-yellow-800 mt-1">
                      QB Entity "{conflictDetails.qbName}" is already mapped to POS entity "{conflictDetails.mappedPosName}".
                      <br />
                      Do you want to remap it?
                    </p>
                  ) : (
                    <p className="text-sm text-yellow-800 mt-1">
                      POS Entity "{conflictDetails.posName}" is already mapped to QB entity "{conflictDetails.mappedQbName}".
                      <br />
                      Do you want to remap it?
                    </p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setShowConflictWarning(false);
                    setConflictDetails(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleOverrideConflict}
                >
                  Remap Anyway
                </Button>
              </div>
            </div>
          ) : (
            <>
              {twoWayEdit && (
                <div className="grid grid-cols-2 gap-4 p-3 bg-gray-50 rounded-md">
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-1">POS Entity</p>
                    <p className="text-sm font-mono">{selectedPosId || '(not selected)'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-1">QB Entity</p>
                    <p className="text-sm font-mono">{selectedQbId || '(not selected)'}</p>
                  </div>
                </div>
              )}

              {/* Search Tabs */}
              <div className="flex gap-2 border-b">
                <button
                  onClick={() => {
                    setTab('qb');
                    setQuery('');
                    setResults([]);
                  }}
                  className={`px-4 py-2 text-sm font-medium border-b-2 ${
                    tab === 'qb'
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Search QB
                </button>
                {twoWayEdit && (
                  <button
                    onClick={() => {
                      setTab('pos');
                      setQuery('');
                      setResults([]);
                    }}
                    className={`px-4 py-2 text-sm font-medium border-b-2 ${
                      tab === 'pos'
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    Search POS
                  </button>
                )}
              </div>

              {/* Search Input */}
              <div className="flex gap-2">
                <Input
                  placeholder={`Search ${tab === 'qb' ? 'QB' : 'POS'} ${entityType}s...`}
                  value={query}
                  onChange={(e) => handleSearch(e.target.value)}
                  disabled={loading}
                />
                {loading && <RefreshCw className="h-4 w-4 animate-spin" />}
              </div>

              {/* Results */}
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {loading ? (
                  <p className="text-sm text-gray-500 text-center py-4">Searching...</p>
                ) : results.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">
                    {query ? 'No results found' : 'Type to search'}
                  </p>
                ) : (
                  results.map((result, idx) => (
                    <div
                      key={idx}
                      className="p-2 border rounded-md cursor-pointer hover:bg-blue-50 flex items-center justify-between"
                      onClick={() =>
                        tab === 'qb' ? handleSelectQb(result) : handleSelectPos(result)
                      }
                    >
                      <div className="flex-1">
                        <p className="text-sm font-medium">
                          {tab === 'qb' ? result.qbName : result.localName}
                        </p>
                        <p className="text-xs text-gray-500">
                          {tab === 'qb' ? result.qbId : result.localId}
                        </p>
                        {result.alreadyMapped && (
                          <Badge variant="secondary" className="mt-1 text-xs">
                            {tab === 'qb'
                              ? `Mapped to: ${result.mappedTo?.localName}`
                              : `Mapped to: ${result.mappedTo?.qbName}`}
                          </Badge>
                        )}
                      </div>
                      <Button size="sm" variant="outline">
                        Select
                      </Button>
                    </div>
                  ))
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 pt-4">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={onClose}
                >
                  Cancel
                </Button>
                {twoWayEdit && (
                  <Button
                    className="flex-1"
                    onClick={handleConfirmSelection}
                    disabled={!selectedPosId || !selectedQbId}
                  >
                    Confirm Mapping
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
