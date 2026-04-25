import { prisma } from '../../config/database';

/// Read-only admin queries powering the Master Client List screen.
/// Aggregates organizations, branches, user counts, and QB connection
/// status. Does NOT mutate state — onboarding remains CLI-driven for now.
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
}
