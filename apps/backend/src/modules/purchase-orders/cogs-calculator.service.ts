import { prisma } from '../../config/database';
import { Decimal } from '@prisma/client/runtime/library';

export class COGSCalculatorService {
  /**
   * Calculate weighted average cost per liter for fuel
   * Formula: (oldStock * oldCost + newQty * newCost) / (oldStock + newQty)
   */
  async calculateWeightedAverageCost(
    branchId: string,
    fuelTypeId: string,
    newQuantity: number,
    newCostPerLiter: number
  ): Promise<number> {
    // Get current inventory
    const inventory = await prisma.fuelInventory.findUnique({
      where: {
        branchId_fuelTypeId: {
          branchId,
          fuelTypeId,
        },
      },
    });

    if (!inventory) {
      // First purchase - return new cost as average
      return newCostPerLiter;
    }

    const oldStock = Number(inventory.currentStock);
    const oldCost = Number(inventory.avgCostPerLiter);

    if (oldStock === 0) {
      // No existing stock - return new cost
      return newCostPerLiter;
    }

    // Weighted average calculation
    const oldTotal = oldStock * oldCost;
    const newTotal = newQuantity * newCostPerLiter;
    const newAverage = (oldTotal + newTotal) / (oldStock + newQuantity);

    return Number(newAverage.toFixed(2));
  }

  /**
   * Update fuel inventory with new receipt
   */
  async updateFuelInventory(
    branchId: string,
    fuelTypeId: string,
    quantity: number,
    costPerLiter: number,
    purchaseOrderId: string
  ) {
    // Calculate new weighted average cost
    const newAvgCost = await this.calculateWeightedAverageCost(
      branchId,
      fuelTypeId,
      quantity,
      costPerLiter
    );

    // Upsert inventory record
    const inventory = await prisma.fuelInventory.upsert({
      where: {
        branchId_fuelTypeId: {
          branchId,
          fuelTypeId,
        },
      },
      create: {
        branchId,
        fuelTypeId,
        currentStock: new Decimal(quantity),
        avgCostPerLiter: new Decimal(newAvgCost),
        lastReceiptDate: new Date(),
      },
      update: {
        currentStock: {
          increment: new Decimal(quantity),
        },
        avgCostPerLiter: new Decimal(newAvgCost),
        lastReceiptDate: new Date(),
      },
    });

    // Create transaction log
    await prisma.fuelInventoryTransaction.create({
      data: {
        inventoryId: inventory.id,
        transactionType: 'receipt',
        quantity: new Decimal(quantity),
        costPerLiter: new Decimal(costPerLiter),
        referenceType: 'purchase_order',
        referenceId: purchaseOrderId,
        notes: `Stock receipt from PO`,
      },
    });

    return inventory;
  }

  /**
   * Record fuel sale (decrease inventory)
   */
  async recordFuelSale(
    branchId: string,
    fuelTypeId: string,
    quantity: number,
    saleId: string
  ) {
    const inventory = await prisma.fuelInventory.findUnique({
      where: {
        branchId_fuelTypeId: {
          branchId,
          fuelTypeId,
        },
      },
    });

    if (!inventory) {
      throw new Error('Fuel inventory not found');
    }

    if (Number(inventory.currentStock) < quantity) {
      throw new Error('Insufficient fuel stock');
    }

    // Update inventory
    const updated = await prisma.fuelInventory.update({
      where: { id: inventory.id },
      data: {
        currentStock: {
          decrement: new Decimal(quantity),
        },
      },
    });

    // Create transaction log
    await prisma.fuelInventoryTransaction.create({
      data: {
        inventoryId: inventory.id,
        transactionType: 'sale',
        quantity: new Decimal(-quantity), // Negative for sales
        costPerLiter: inventory.avgCostPerLiter,
        referenceType: 'sale',
        referenceId: saleId,
      },
    });

    return updated;
  }
}
