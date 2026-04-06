import { prisma } from '../../config/database';

export class BanksService {
  /**
   * Get all active banks for organization
   */
  async getAll(organizationId: string) {
    const banks = await prisma.bank.findMany({
      where: {
        organizationId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        code: true,
        accountNumber: true,
        accountTitle: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    return banks;
  }
}
