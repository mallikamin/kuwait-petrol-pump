# Reconciliation Flow - Implementation Guide

## Current State
- Build: b0f3e8d
- Test Data: 700L HSD sold (200L + 500L)
- All modules working except reconciliation flow

## Phase 1: Dashboard - Sold Volumes (30 min)

### Backend Changes
**File**: `apps/backend/src/modules/dashboard/dashboard.service.ts`

Add calculation:
```typescript
// Get sold volumes for current shift/day
const fuelSales = await prisma.meterReading.groupBy({
  by: ['nozzle_id'],
  where: {
    shift_instance_id: currentShift?.id,
    reading_type: 'closing'
  },
  _sum: { meter_value: true }
});

// Calculate by fuel type
const pmgSold = ...
const hsdSold = ...
```

### Frontend Changes
**File**: `apps/web/src/pages/Dashboard.tsx`

Change:
```tsx
// OLD
<span>PMG Available: {stats.pmg_available} Liters</span>
<span>HSD Available: {stats.hsd_available} Liters</span>

// NEW
<span>PMG Sold: {stats.pmg_sold_liters} Liters</span>
<span>HSD Sold: {stats.hsd_sold_liters} Liters</span>
```

## Phase 2: Sales Tab - Real-Time (45 min)

**File**: `apps/web/src/pages/Sales.tsx`

Add display:
```tsx
<Card>
  <CardHeader>Fuel Sales Today</CardHeader>
  <CardContent>
    <div>Total Volume: {totalLiters} L</div>
    <div>Total Amount: {totalAmount} KWD</div>
    <Separator />
    <div>Credit Sales: {creditAmount} KWD</div>
    <div>Card Sales: {cardAmount} KWD</div>
    <div>Cash Sales: {cashAmount} KWD</div>
  </CardContent>
</Card>
```

## Phase 3: Reconciliation Rename (1 hour)

### Files to Update:
1. Rename: `apps/web/src/pages/Bifurcation.tsx` → `Reconciliation.tsx`
2. Update: `apps/web/src/App.tsx` route
3. Update: `apps/web/src/components/layout/Sidebar.tsx` menu

### Auto-Fetch Logic:
```typescript
const loadReconciliationData = async (shiftId) => {
  // Fetch fuel sales from meter readings
  const fuelSales = await api.get(`/reconciliation/${shiftId}/fuel-sales`);
  
  // Pre-fill form
  setFormData({
    pmgLiters: fuelSales.pmg_liters,
    hsdLiters: fuelSales.hsd_liters,
    totalAmount: fuelSales.total_amount,
    // User enters: actual cash, card amounts
  });
};
```

## Testing Flow
1. Enter meter readings → Check Dashboard shows sold volumes
2. Check Sales tab → Shows payment breakdown
3. Open Reconciliation → All values pre-filled
4. Enter actual cash → See variance

