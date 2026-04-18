import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MonthlyInventoryGainLoss } from './MonthlyInventoryGainLoss';
import { apiClient } from '@/api/client';
import { inventoryApi } from '@/api/inventory';

vi.mock('@/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const wrap = (ui: React.ReactNode) => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

describe('MonthlyInventoryGainLoss — render', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiClient.get as any).mockImplementation((path: string) => {
      if (path === '/fuel-prices/fuel-types') {
        return Promise.resolve({
          data: [
            { id: 'fuel-hsd', code: 'HSD', name: 'High Speed Diesel' },
            { id: 'fuel-pmg', code: 'PMG', name: 'Premium Motor Gasoline' },
          ],
        });
      }
      if (path === '/inventory/monthly-gain-loss') {
        return Promise.resolve({ data: { entries: [], count: 0 } });
      }
      return Promise.reject(new Error(`Unexpected path: ${path}`));
    });
  });

  it('mounts and renders form + empty-state message', async () => {
    wrap(<MonthlyInventoryGainLoss branchId="branch-1" />);

    expect(await screen.findByText(/Monthly Inventory Gain\/Loss/i)).toBeInTheDocument();
    expect(screen.getByText(/Record month-end fuel count adjustments/i)).toBeInTheDocument();
    expect(screen.getByText(/Record Entry/i)).toBeInTheDocument();
    // Empty state shows for current month when entries.length === 0
    await waitFor(() => {
      expect(screen.getByText(/No entries for/)).toBeInTheDocument();
    });
  });

  it('uses /fuel-prices/fuel-types (not the broken /fuel-types)', async () => {
    wrap(<MonthlyInventoryGainLoss branchId="branch-1" />);
    await waitFor(() => {
      const calls = (apiClient.get as any).mock.calls.map((c: any[]) => c[0]);
      expect(calls).toContain('/fuel-prices/fuel-types');
      expect(calls).not.toContain('/fuel-types');
    });
  });
});

describe('inventoryApi — API contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getGainLossEntries returns { entries, count } shape', async () => {
    (apiClient.get as any).mockResolvedValueOnce({
      data: {
        entries: [
          {
            id: 'e1', branchId: 'b1', fuelTypeId: 'fuel-hsd', month: '2026-04',
            quantity: 50, remarks: 'physical count', recordedBy: 'u1',
            recordedAt: '2026-04-15T10:00:00.000Z',
            fuel: { code: 'HSD', name: 'High Speed Diesel' },
            recordedByUser: { id: 'u1', username: 'admin', fullName: 'Admin' },
          },
        ],
        count: 1,
      },
    });

    const result = await inventoryApi.getGainLossEntries({ branchId: 'b1', month: '2026-04' });

    expect(result.count).toBe(1);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toEqual(
      expect.objectContaining({
        id: 'e1',
        month: '2026-04',
        quantity: 50,
        fuel: expect.objectContaining({ code: 'HSD' }),
      }),
    );

    const callPath = (apiClient.get as any).mock.calls[0][0];
    const callParams = (apiClient.get as any).mock.calls[0][1]?.params;
    expect(callPath).toBe('/inventory/monthly-gain-loss');
    expect(callParams).toEqual({ branchId: 'b1', month: '2026-04' });
  });

  it('createGainLossEntry posts to /inventory/monthly-gain-loss with the right body', async () => {
    (apiClient.post as any).mockResolvedValueOnce({
      data: { id: 'e-new', branchId: 'b1', fuelTypeId: 'fuel-hsd', month: '2026-04', quantity: -25 },
    });

    await inventoryApi.createGainLossEntry({
      branchId: 'b1', fuelTypeId: 'fuel-hsd', month: '2026-04', quantity: -25, remarks: 'spillage',
    });

    const [path, body] = (apiClient.post as any).mock.calls[0];
    expect(path).toBe('/inventory/monthly-gain-loss');
    expect(body).toEqual({
      branchId: 'b1', fuelTypeId: 'fuel-hsd', month: '2026-04', quantity: -25, remarks: 'spillage',
    });
  });
});
