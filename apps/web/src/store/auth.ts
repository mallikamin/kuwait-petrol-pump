import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User } from '@/types';

/// Lightweight org descriptor used by the org/branch switcher.
/// Mirrors the payload from GET /api/auth/accessible-orgs.
export interface AccessibleBranch {
  id: string;
  code: string | null;
  name: string;
  isActive: boolean;
}

export interface AccessibleOrg {
  id: string;
  code: string | null;
  name: string;
  companyName: string | null;
  companyAddress: string | null;
  currency: string;
  timezone: string;
  isDemo: boolean;
  reportFooter: string | null;
  isPrimary: boolean;
  branches: AccessibleBranch[];
}

interface AuthState {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  /// Cross-org access (populated after login by fetching /api/auth/accessible-orgs).
  /// Single-org users get exactly one entry — the switcher hides itself in that case.
  accessibleOrgs: AccessibleOrg[];
  /// Currently selected org for cross-org users. NULL = use JWT default (primary org).
  activeOrgId: string | null;
  /// Currently selected branch within the active org. NULL = "All Branches"
  /// (only meaningful for users with the cross-branch view privilege; service
  /// layer continues to enforce branch-scoping rules).
  activeBranchId: string | null;
  setAuth: (user: User, token: string, refreshToken?: string | null) => void;
  setToken: (token: string) => void;
  setAccessibleOrgs: (orgs: AccessibleOrg[]) => void;
  setActiveOrg: (orgId: string | null) => void;
  setActiveBranch: (branchId: string | null) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,
      accessibleOrgs: [],
      activeOrgId: null,
      activeBranchId: null,
      setAuth: (user, token, refreshToken = null) =>
        set({
          user,
          token,
          refreshToken,
          isAuthenticated: true,
          // Reset active context on every new login so a previous user's
          // selection doesn't leak into this session.
          activeOrgId: null,
          activeBranchId: user.branch_id ?? null,
          accessibleOrgs: [],
        }),
      setToken: (token) => set((state) => ({ ...state, token, isAuthenticated: true })),
      setAccessibleOrgs: (orgs) =>
        set((state) => {
          // On first fetch, anchor activeOrgId to the user's primary org.
          const next: Partial<AuthState> = { accessibleOrgs: orgs };
          let nextActiveOrgId = state.activeOrgId;
          if (!nextActiveOrgId && orgs.length) {
            const primary = orgs.find((o) => o.isPrimary) ?? orgs[0];
            nextActiveOrgId = primary.id;
            next.activeOrgId = primary.id;
          }
          // Repair activeBranchId on hydration: if it's null OR points to a
          // branch that doesn't exist in the active org (e.g. a stored
          // selection from a previous org), auto-pick the first branch of
          // the active org so X-Active-Branch-Id stays in sync.
          const activeOrg = orgs.find((o) => o.id === nextActiveOrgId);
          if (activeOrg && activeOrg.branches.length) {
            const stillValid = activeOrg.branches.some((b) => b.id === state.activeBranchId);
            if (!stillValid) {
              next.activeBranchId = activeOrg.branches[0].id;
            }
          }
          return next;
        }),
      setActiveOrg: (orgId) =>
        set((state) => {
          if (orgId === state.activeOrgId) return state;
          // Auto-pick the first branch of the new org so the active scope
          // is always explicit (and X-Active-Branch-Id is always sent on
          // requests). Without this, branch-required endpoints like
          // /api/dashboard/liters-sold and /api/shifts return 400 because
          // the JWT branch belongs to the old org and was cleared by the
          // auth middleware. Users can still switch to "All Branches"
          // explicitly via the branch dropdown if they want org-wide views.
          const newOrg = state.accessibleOrgs.find((o) => o.id === orgId);
          const firstBranchId = newOrg?.branches[0]?.id ?? null;
          return { ...state, activeOrgId: orgId, activeBranchId: firstBranchId };
        }),
      setActiveBranch: (branchId) => set((state) => ({ ...state, activeBranchId: branchId })),
      logout: () =>
        set({
          user: null,
          token: null,
          refreshToken: null,
          isAuthenticated: false,
          accessibleOrgs: [],
          activeOrgId: null,
          activeBranchId: null,
        }),
    }),
    {
      name: 'auth-storage',
    }
  )
);

/// Convenience selector returning the currently active org descriptor (or null
/// when accessible-orgs hasn't loaded yet / user is single-org with no fetch).
export function useActiveOrg(): AccessibleOrg | null {
  return useAuthStore((s) => s.accessibleOrgs.find((o) => o.id === s.activeOrgId) ?? null);
}
