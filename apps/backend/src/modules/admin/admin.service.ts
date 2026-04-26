import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';

/// Admin queries powering the Master Client List + cross-org grant UX.
/// Read-side aggregates organizations, branches, user counts, and QB
/// connection status. Write-side manages user_org_access grants for
/// cross-org BPO/admin users.
export class AdminService {
  async listClients() {
    const orgs = await prisma.organization.findMany({
      orderBy: [{ isDemo: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        companyName: true,
        companyAddress: true,
        currency: true,
        timezone: true,
        isDemo: true,
        tenancyMode: true,
        createdAt: true,
        branches: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            code: true,
            name: true,
            location: true,
            isActive: true,
            createdAt: true,
            _count: { select: { users: true } },
          },
        },
        _count: { select: { users: true } },
        qbConnections: {
          where: { isActive: true },
          select: {
            id: true,
            companyName: true,
            realmId: true,
            syncMode: true,
            lastSyncAt: true,
            lastSyncStatus: true,
          },
        },
      },
    });

    return orgs.map((org) => ({
      id: org.id,
      code: org.code,
      name: org.name,
      companyName: org.companyName,
      companyAddress: org.companyAddress,
      currency: org.currency,
      timezone: org.timezone,
      isDemo: org.isDemo,
      tenancyMode: org.tenancyMode,
      createdAt: org.createdAt,
      userCount: org._count.users,
      branches: org.branches.map((b) => ({
        id: b.id,
        code: b.code,
        name: b.name,
        location: b.location,
        isActive: b.isActive,
        createdAt: b.createdAt,
        userCount: b._count.users,
      })),
      qbConnection: org.qbConnections[0]
        ? {
            id: org.qbConnections[0].id,
            companyName: org.qbConnections[0].companyName,
            realmId: org.qbConnections[0].realmId,
            syncMode: org.qbConnections[0].syncMode,
            lastSyncAt: org.qbConnections[0].lastSyncAt,
            lastSyncStatus: org.qbConnections[0].lastSyncStatus,
          }
        : null,
    }));
  }

  /**
   * Returns every user along with the orgs they have explicit cross-org
   * access to (user_org_access rows). Their primary org is reported
   * separately so the UI can render "primary + extra grants" cleanly.
   */
  async listUsersWithOrgAccess() {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      orderBy: [{ organizationId: 'asc' }, { username: 'asc' }],
      select: {
        id: true,
        username: true,
        fullName: true,
        role: true,
        organizationId: true,
        organization: { select: { id: true, code: true, name: true } },
        orgAccess: {
          select: {
            organizationId: true,
            organization: { select: { id: true, code: true, name: true } },
            grantedAt: true,
          },
        },
      },
    });

    return users.map((u) => ({
      id: u.id,
      username: u.username,
      fullName: u.fullName,
      role: u.role,
      primaryOrg: u.organization,
      grantedOrgs: u.orgAccess
        .filter((g) => g.organizationId !== u.organizationId) // primary already shown
        .map((g) => ({ ...g.organization, grantedAt: g.grantedAt })),
    }));
  }

  /**
   * Replaces a user's user_org_access grants with the supplied org list.
   * Atomic: deletes all existing rows for the user, then inserts the new set.
   * The user's primary org (User.organizationId) is auto-included so it can
   * never be revoked accidentally — that would require deactivating the user.
   *
   * @param userId  Target user receiving the grants.
   * @param orgIds  Full desired set of accessible org IDs.
   * @param grantedBy  Admin user performing the grant (audit trail).
   */
  async setUserOrgAccess(userId: string, orgIds: string[], grantedBy: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, organizationId: true },
    });
    if (!user) {
      throw new AppError(404, 'User not found');
    }

    // Always include the user's primary org so we never strip them of their
    // own login org. Dedup + drop empties.
    const desired = Array.from(new Set([user.organizationId, ...orgIds.filter(Boolean)]));

    // Validate every requested org exists.
    const found = await prisma.organization.findMany({
      where: { id: { in: desired } },
      select: { id: true },
    });
    const foundIds = new Set(found.map((o) => o.id));
    const missing = desired.filter((id) => !foundIds.has(id));
    if (missing.length) {
      throw new AppError(400, `Unknown organization id(s): ${missing.join(', ')}`);
    }

    await prisma.$transaction([
      prisma.userOrgAccess.deleteMany({ where: { userId } }),
      prisma.userOrgAccess.createMany({
        data: desired.map((organizationId) => ({
          userId,
          organizationId,
          grantedBy,
        })),
      }),
    ]);

    return this.getUserOrgAccess(userId);
  }

  async getUserOrgAccess(userId: string) {
    const rows = await prisma.userOrgAccess.findMany({
      where: { userId },
      orderBy: { grantedAt: 'asc' },
      select: {
        organizationId: true,
        grantedAt: true,
        organization: { select: { id: true, code: true, name: true } },
      },
    });
    return {
      userId,
      orgs: rows.map((r) => ({ ...r.organization, grantedAt: r.grantedAt })),
    };
  }
}
