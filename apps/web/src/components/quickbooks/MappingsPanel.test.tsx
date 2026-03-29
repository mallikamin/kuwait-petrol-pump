import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MappingsPanel } from './MappingsPanel';
import { quickbooksApi } from '@/api/quickbooks';
import { toast } from 'sonner';

// Mock API
vi.mock('@/api/quickbooks', () => ({
  quickbooksApi: {
    getMappings: vi.fn(),
    createMapping: vi.fn(),
    bulkCreateMappings: vi.fn(),
  },
}));

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

describe('MappingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should load and display mappings from wrapped response', async () => {
    const mockResponse = {
      success: true,
      count: 1,
      mappings: [
        {
          id: '1',
          entityType: 'customer' as const,
          localId: 'walk-in',
          localName: 'Walk-in Customer',
          qbId: '123',
          qbName: 'Walk-in',
          createdAt: '2026-03-29T00:00:00Z',
          updatedAt: '2026-03-29T00:00:00Z',
        },
      ],
    };
    (quickbooksApi.getMappings as any).mockResolvedValue(mockResponse);

    render(<MappingsPanel userRole="admin" />);

    await waitFor(() => {
      expect(screen.getByText('Walk-in Customer')).toBeInTheDocument();
    });
  });

  it('should show add mapping button for admin/manager', async () => {
    (quickbooksApi.getMappings as any).mockResolvedValue({
      success: true,
      count: 0,
      mappings: [],
    });

    render(<MappingsPanel userRole="admin" />);

    await waitFor(() => {
      expect(screen.getByText(/Add Mapping/i)).toBeInTheDocument();
    });
  });

  it('should not show edit controls for cashier', async () => {
    (quickbooksApi.getMappings as any).mockResolvedValue({
      success: true,
      count: 0,
      mappings: [],
    });

    render(<MappingsPanel userRole="cashier" />);

    await waitFor(() => {
      expect(screen.queryByText(/Add Mapping/i)).not.toBeInTheDocument();
    });
  });

  it('should validate form fields', async () => {
    (quickbooksApi.getMappings as any).mockResolvedValue({
      success: true,
      count: 0,
      mappings: [],
    });

    render(<MappingsPanel userRole="admin" />);

    await waitFor(() => {
      fireEvent.click(screen.getByText(/Add Mapping/i));
    });

    // Submit empty form
    const submitButton = await screen.findByText(/Create Mapping/i);
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getAllByText('Required').length).toBeGreaterThan(0);
    });
  });

  it('should create mapping with correct localId/qbId keys', async () => {
    (quickbooksApi.getMappings as any).mockResolvedValue({
      success: true,
      count: 0,
      mappings: [],
    });
    (quickbooksApi.createMapping as any).mockResolvedValue({
      success: true,
      mapping: { id: '1' },
    });

    render(<MappingsPanel userRole="admin" />);

    await waitFor(() => {
      fireEvent.click(screen.getByText(/Add Mapping/i));
    });

    // Fill form
    const localIdInput = await screen.findByLabelText(/Local Entity ID/i);
    fireEvent.change(localIdInput, { target: { value: 'walk-in' } });

    const localNameInput = screen.getByLabelText(/Local Name/i);
    fireEvent.change(localNameInput, { target: { value: 'Walk-in Customer' } });

    const qbIdInput = screen.getByLabelText(/QuickBooks Entity ID/i);
    fireEvent.change(qbIdInput, { target: { value: '123' } });

    const qbNameInput = screen.getByLabelText(/QuickBooks Name/i);
    fireEvent.change(qbNameInput, { target: { value: 'Walk-in' } });

    // Submit
    const submitButton = screen.getByText(/Create Mapping/i);
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(quickbooksApi.createMapping).toHaveBeenCalledWith({
        entityType: 'customer',
        localId: 'walk-in',
        localName: 'Walk-in Customer',
        qbId: '123',
        qbName: 'Walk-in',
      });
    });
  });

  it('should handle bulk import with correct field names', async () => {
    (quickbooksApi.getMappings as any).mockResolvedValue({
      success: true,
      count: 0,
      mappings: [],
    });
    (quickbooksApi.bulkCreateMappings as any).mockResolvedValue({
      success: true,
      totalRows: 2,
      successCount: 2,
      failureCount: 0,
      results: [
        { success: true, entityType: 'customer', localId: 'walk-in', qbId: '123' },
        { success: true, entityType: 'item', localId: 'PMG', qbId: '456' },
      ],
    });

    render(<MappingsPanel userRole="admin" />);

    await waitFor(() => {
      fireEvent.click(screen.getByText(/Bulk Import/i));
    });

    const textarea = await screen.findByRole('textbox', { name: '' });
    fireEvent.change(textarea, {
      target: {
        value: 'customer,walk-in,Walk-in,123,Walk-in\nitem,PMG,Petrol,456,Petrol',
      },
    });

    const importButton = screen.getByText(/^Import$/i);
    fireEvent.click(importButton);

    await waitFor(() => {
      expect(quickbooksApi.bulkCreateMappings).toHaveBeenCalledWith({
        mappings: [
          {
            entityType: 'customer',
            localId: 'walk-in',
            localName: 'Walk-in',
            qbId: '123',
            qbName: 'Walk-in',
          },
          {
            entityType: 'item',
            localId: 'PMG',
            localName: 'Petrol',
            qbId: '456',
            qbName: 'Petrol',
          },
        ],
      });
    });
  });

  it('should handle partial bulk failures with correct backend response shape', async () => {
    (quickbooksApi.getMappings as any).mockResolvedValue({
      success: true,
      count: 0,
      mappings: [],
    });
    (quickbooksApi.bulkCreateMappings as any).mockResolvedValue({
      success: true,
      totalRows: 3,
      successCount: 2,
      failureCount: 1,
      results: [
        { success: true, entityType: 'customer', localId: 'walk-in', qbId: '123' },
        { success: true, entityType: 'item', localId: 'PMG', qbId: '456' },
        {
          success: false,
          entityType: 'payment_method',
          localId: 'invalid',
          error: 'QB entity not found',
        },
      ],
    });

    render(<MappingsPanel userRole="admin" />);

    await waitFor(() => {
      fireEvent.click(screen.getByText(/Bulk Import/i));
    });

    const textarea = await screen.findByRole('textbox', { name: '' });
    fireEvent.change(textarea, {
      target: {
        value:
          'customer,walk-in,Walk-in,123,Walk-in\nitem,PMG,Petrol,456,Petrol\npayment_method,invalid,Invalid,789,Bad',
      },
    });

    const importButton = screen.getByText(/^Import$/i);
    fireEvent.click(importButton);

    await waitFor(() => {
      // Verify warning toast shows correct counts from backend response
      expect(toast.warning).toHaveBeenCalledWith('2 created, 1 errors');
    });
  });

  it('should not call nonexistent delete endpoint', async () => {
    const mockResponse = {
      success: true,
      count: 1,
      mappings: [
        {
          id: '1',
          entityType: 'customer' as const,
          localId: 'walk-in',
          localName: 'Walk-in Customer',
          qbId: '123',
          qbName: 'Walk-in',
          createdAt: '2026-03-29T00:00:00Z',
          updatedAt: '2026-03-29T00:00:00Z',
        },
      ],
    };
    (quickbooksApi.getMappings as any).mockResolvedValue(mockResponse);

    render(<MappingsPanel userRole="admin" />);

    await waitFor(() => {
      expect(screen.getByText('Walk-in Customer')).toBeInTheDocument();
    });

    // Verify delete button does not exist (Actions column removed)
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });
});
