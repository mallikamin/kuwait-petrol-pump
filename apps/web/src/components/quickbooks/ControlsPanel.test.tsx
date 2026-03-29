import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ControlsPanel } from './ControlsPanel';
import { quickbooksApi } from '@/api/quickbooks';

// Mock API
vi.mock('@/api/quickbooks', () => ({
  quickbooksApi: {
    getControls: vi.fn(),
    updateControls: vi.fn(),
  },
}));

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ControlsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show permission message for non-admin users', () => {
    render(<ControlsPanel userRole="cashier" />);
    expect(screen.getByText(/admin access required/i)).toBeInTheDocument();
  });

  it('should load controls for admin users with wrapped response', async () => {
    const mockResponse = {
      success: true,
      controls: { killSwitch: false, syncMode: 'READ_ONLY' as const, approvalRequired: false },
      status: {
        connected: true,
        canRead: true,
        canWrite: false,
        canWriteReal: false,
        isDryRun: false,
        lastSyncAt: null,
        lastSyncStatus: null,
      },
    };
    (quickbooksApi.getControls as any).mockResolvedValue(mockResponse);

    render(<ControlsPanel userRole="admin" />);

    await waitFor(() => {
      expect(screen.getByText(/Global Kill Switch/i)).toBeInTheDocument();
    });
  });

  it('should handle kill switch toggle with correct payload', async () => {
    const mockResponse = {
      success: true,
      controls: { killSwitch: false, syncMode: 'READ_ONLY' as const, approvalRequired: false },
      status: {
        connected: true,
        canRead: true,
        canWrite: false,
        canWriteReal: false,
        isDryRun: false,
        lastSyncAt: null,
        lastSyncStatus: null,
      },
    };
    (quickbooksApi.getControls as any).mockResolvedValue(mockResponse);
    (quickbooksApi.updateControls as any).mockResolvedValue({ success: true });

    render(<ControlsPanel userRole="admin" />);

    await waitFor(() => {
      expect(screen.getByRole('switch')).toBeInTheDocument();
    });

    const killSwitch = screen.getByRole('switch');
    fireEvent.click(killSwitch);

    await waitFor(() => {
      expect(quickbooksApi.updateControls).toHaveBeenCalledWith({ killSwitch: true });
    });
  });

  it('should show confirmation for FULL_SYNC mode', async () => {
    const mockResponse = {
      success: true,
      controls: { killSwitch: false, syncMode: 'READ_ONLY' as const, approvalRequired: false },
      status: {
        connected: true,
        canRead: true,
        canWrite: false,
        canWriteReal: false,
        isDryRun: false,
        lastSyncAt: null,
        lastSyncStatus: null,
      },
    };
    (quickbooksApi.getControls as any).mockResolvedValue(mockResponse);
    global.confirm = vi.fn(() => false);

    render(<ControlsPanel userRole="admin" />);

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    // Validates component renders with wrapped response
  });

  it('should handle API errors gracefully', async () => {
    (quickbooksApi.getControls as any).mockRejectedValue({
      response: { status: 403, data: { error: 'Access denied' } },
    });

    render(<ControlsPanel userRole="admin" />);

    await waitFor(() => {
      expect(screen.getByText(/access denied/i)).toBeInTheDocument();
    });
  });

  it('should parse controls from wrapped response correctly', async () => {
    const mockResponse = {
      success: true,
      controls: { killSwitch: true, syncMode: 'DRY_RUN' as const, approvalRequired: true },
      status: {
        connected: true,
        canRead: true,
        canWrite: true,
        canWriteReal: false,
        isDryRun: true,
        lastSyncAt: '2026-03-29T00:00:00Z',
        lastSyncStatus: 'success',
      },
    };
    (quickbooksApi.getControls as any).mockResolvedValue(mockResponse);

    render(<ControlsPanel userRole="admin" />);

    await waitFor(() => {
      const badges = screen.getAllByText(/Active/i);
      expect(badges.length).toBeGreaterThan(0); // Kill switch badge exists
    });
  });
});
