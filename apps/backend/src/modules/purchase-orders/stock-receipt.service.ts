import { prisma } from '../../config/database';
import { AppError } from '../../middleware/error.middleware';
import { Decimal } from '@prisma/client/runtime/library';
import { ReceiveStockInput } from './purchase-orders.schema';

export class StockReceiptService {
  /**
   * Receive stock from purchase order
   * This is a complex transaction that:
   * 1. Validates PO and quantities
   * 2. Creates stock receipt record
   * 3. Updates PO item quantities received
   * 4. Updates inventory (fuel or product)
   * 5. Recalculates COGS for fuel
   * 6. Updates PO status
   */
  async receiveStock(
    purchaseOrderId: string,
    organizationId: string,
    userId: string,
    input: ReceiveStockInput
  ) {
    return await prisma.$transaction(async (tx) => {
      // 1. Validate PO exists and belongs to organization
      const po = await tx.purchaseOrder.findFirst({
        where: {
          id: purchaseOrderId,
          organizationId,
        },
        include: {
          items: {
            include: {
              fuelType: true,
              product: true,
            },
          },
        },
      });

      if (!po) {
        throw new AppError(404, 'Purchase order not found');
      }

      if (po.status === 'cancelled') {
        throw new AppError(400, 'Cannot receive stock for cancelled PO');
      }

      if (po.status === 'draft') {
        throw new AppError(400, 'PO must be confirmed before receiving stock');
      }

      // 2. Validate receipt items
      for (const receiptItem of input.items) {
        const poItem = po.items.find(item => item.id === receiptItem.poItemId);

        if (!poItem) {
          throw new AppError(404, `PO item ${receiptItem.poItemId} not found`);
        }

        const alreadyReceived = Number(poItem.quantityReceived);
        const ordered = Number(poItem.quantityOrdered);
        const newTotal = alreadyReceived + receiptItem.quantityReceived;

        if (newTotal > ordered) {
          throw new AppError(
            400,
            `Cannot receive ${receiptItem.quantityReceived} - would exceed ordered quantity ${ordered}`
          );
        }
      }

      // 3. Check for duplicate receipt number
      const existingReceipt = await tx.stockReceipt.findUnique({
        where: { receiptNumber: input.receiptNumber },
      });

      if (existingReceipt) {
        throw new AppError(400, 'Receipt number already exists');
      }

      // 4. Create stock receipt
      const receipt = await tx.stockReceipt.create({
        data: {
          purchaseOrderId,
          receiptNumber: input.receiptNumber,
          receiptDate: input.receiptDate,
          receivedBy: userId,
          notes: input.notes,
        },
      });

      // 5. Process each receipt item
      for (const receiptItem of input.items) {
        const poItem = po.items.find(item => item.id === receiptItem.poItemId)!;

        // Create receipt item record
        await tx.stockReceiptItem.create({
          data: {
            stockReceiptId: receipt.id,
            poItemId: poItem.id,
            quantityReceived: new Decimal(receiptItem.quantityReceived),
          },
        });

        // Update PO item quantity received
        await tx.purchaseOrderItem.update({
          where: { id: poItem.id },
          data: {
            quantityReceived: {
              increment: new Decimal(receiptItem.quantityReceived),
            },
          },
        });

        // Update inventory based on item type
        if (poItem.itemType === 'fuel' && poItem.fuelTypeId) {
          // Update fuel inventory with COGS calculation (inline, using tx)
          const costPerLiter = Number(poItem.costPerUnit);
          const qty = receiptItem.quantityReceived;

          // Calculate weighted average cost
          const existingInventory = await tx.fuelInventory.findUnique({
            where: {
              branchId_fuelTypeId: {
                branchId: po.branchId,
                fuelTypeId: poItem.fuelTypeId,
              },
            },
          });

          let newAvgCost: number;
          if (!existingInventory || Number(existingInventory.currentStock) === 0) {
            newAvgCost = costPerLiter;
          } else {
            const oldStock = Number(existingInventory.currentStock);
            const oldCost = Number(existingInventory.avgCostPerLiter);
            newAvgCost = Number(
              ((oldStock * oldCost + qty * costPerLiter) / (oldStock + qty)).toFixed(2)
            );
          }

          // Upsert inventory record
          const inventory = await tx.fuelInventory.upsert({
            where: {
              branchId_fuelTypeId: {
                branchId: po.branchId,
                fuelTypeId: poItem.fuelTypeId,
              },
            },
            create: {
              branchId: po.branchId,
              fuelTypeId: poItem.fuelTypeId,
              currentStock: new Decimal(qty),
              avgCostPerLiter: new Decimal(newAvgCost),
              lastReceiptDate: new Date(),
            },
            update: {
              currentStock: {
                increment: new Decimal(qty),
              },
              avgCostPerLiter: new Decimal(newAvgCost),
              lastReceiptDate: new Date(),
            },
          });

          // Create transaction log
          await tx.fuelInventoryTransaction.create({
            data: {
              inventoryId: inventory.id,
              transactionType: 'receipt',
              quantity: new Decimal(qty),
              costPerLiter: new Decimal(costPerLiter),
              referenceType: 'purchase_order',
              referenceId: po.id,
              notes: `Stock receipt from PO`,
            },
          });
        } else if (poItem.itemType === 'product' && poItem.productId) {
          // Update product stock level
          await tx.stockLevel.upsert({
            where: {
              productId_branchId: {
                productId: poItem.productId,
                branchId: po.branchId,
              },
            },
            create: {
              productId: poItem.productId,
              branchId: po.branchId,
              quantity: receiptItem.quantityReceived,
            },
            update: {
              quantity: {
                increment: receiptItem.quantityReceived,
              },
            },
          });
        }
      }

      // 6. Update PO status
      const updatedPO = await tx.purchaseOrder.findUnique({
        where: { id: purchaseOrderId },
        include: { items: true },
      });

      const allItemsFullyReceived = updatedPO!.items.every(
        item => Number(item.quantityReceived) >= Number(item.quantityOrdered)
      );

      const someItemsReceived = updatedPO!.items.some(
        item => Number(item.quantityReceived) > 0
      );

      let newStatus = po.status;
      if (allItemsFullyReceived) {
        newStatus = 'received';
      } else if (someItemsReceived && po.status !== 'received') {
        newStatus = 'partial_received';
      }

      await tx.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: {
          status: newStatus,
          isFullyReceived: allItemsFullyReceived,
          receivedDate: allItemsFullyReceived ? input.receiptDate : null,
        },
      });

      return receipt;
    });
  }
}
