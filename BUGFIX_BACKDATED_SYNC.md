# Backdated Transactions Sync + Meter Reading Edit/Delete Fix

## Issues
1. **Can't edit/delete meter readings** - No UPDATE/DELETE endpoints
2. **Backdated transactions don't sync to Sales tab** - finalize() doesn't create sale records

## Implementation Plan

### 1. Add DELETE /api/meter-readings/:id
- Allow deletion if shift not yet closed
- Add audit trail (who deleted, when)
- Return success message

### 2. Add PATCH /api/meter-readings/:id
- Allow updating meter_value
- Validate: only if shift not closed
- Prevent changing nozzle/shift/type (only meter value)

### 3. Modify finalizeDay() to create sale records
- For each backdatedTransaction, create:
  - `sale` record (parent)
  - `fuel_sale` record (child with fuel details)
- Map fields:
  - `sale.totalAmount` = transaction.lineTotal
  - `sale.paymentMethod` = transaction.paymentMethod
  - `sale.customerId` = transaction.customerId
  - `sale.vehicleNumber` = transaction.vehicleNumber
  - `sale.slipNumber` = transaction.slipNumber
  - `fuel_sale.quantityLiters` = transaction.quantity
  - `fuel_sale.pricePerLiter` = transaction.unitPrice
- Add `backdatedTransactionId` foreign key to `sale` table for traceability

## Files to Modify
- `apps/backend/src/modules/meter-readings/meter-readings.routes.ts`
- `apps/backend/src/modules/meter-readings/meter-readings.controller.ts`
- `apps/backend/src/modules/meter-readings/meter-readings.service.ts`
- `apps/backend/src/modules/backdated-entries/daily.service.ts`
- `packages/database/prisma/schema.prisma` (add sale.backdatedTransactionId?)
