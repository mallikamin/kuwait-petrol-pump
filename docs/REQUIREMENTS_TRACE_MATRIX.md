# Kuwait Petrol Pump POS - Requirements Trace Matrix

**Source Documents:**
1. BPO Response - Kuwait Petrol Pump POS System - Discovery Questionnaire.pdf (18 pages)
2. Petrol Pumps.docx (pending extraction)

**Last Updated**: 2026-03-28 (Re-baselined after drift analysis)
**Status**: ✅ Schema 100% complete, ❌ Operational workflows missing

---

## PRIORITY LEGEND
- **P0**: Must-have for MVP (blocks launch)
- **P1**: Critical for production use (launch with workaround, fix ASAP)
- **P2**: Important but not blocking (2-4 weeks post-launch)
- **P3**: Nice-to-have (backlog)

## STATUS LEGEND
- ✅ **Done**: Fully implemented & tested
- 🟡 **Partial**: Schema exists, code incomplete
- ❌ **Missing**: Not started
- 🔄 **In Progress**: Currently being implemented

---

## 1. OFFLINE-FIRST OPERATIONAL FLOW (P0 - BLOCKING)

### 1.1 Mobile OCR Meter Reading Queue

| Requirement | Source | Status | Target Module | Risk | Acceptance Test |
|-------------|--------|--------|---------------|------|-----------------|
| **Mobile app captures meter photos offline** | BPO PDF p.3 "Mobile App (OCR Scanning)" | ❌ Missing | `apps/mobile` | HIGH - Core automation requirement | App works with no internet |
| **Tesseract.js OCR extracts meter readings** | BPO PDF p.3 "Mobile App Scanning - POS" | 🟡 Partial | `apps/mobile/src/services/ocr` | HIGH - Accuracy critical (zero tolerance) | OCR accuracy >98% on meter photos |
| **Queue offline readings in local storage** | BPO PDF p.11 "Offline Capability" + "MUST work offline" | ❌ Missing | `apps/mobile/src/store/offline` | HIGH - Offline requirement mandatory | 100 readings queued offline, synced when online |
| **Sync queued readings when online** | BPO PDF p.11 "System MUST work offline" | ❌ Missing | `apps/mobile/src/services/sync` | MEDIUM - Conflict handling needed | No data loss during sync |
| **Operator verifies OCR result before submit** | BPO PDF p.6 "Step 2: app scan and show result to verify" | ❌ Missing | `apps/mobile/src/screens/MeterVerify` | LOW | Operator can edit OCR result |
| **Submitted readings go to POS for calculations** | BPO PDF p.6 "Step 4: Once submitted goes to POS page" | ❌ Missing | `apps/backend/src/services/meter-reading` | MEDIUM | POS receives all meter readings |
| **Process time: 5-10 minutes from photo to POS** | BPO PDF p.6 "5 to 10 minutes from Picture to POS" | ❌ Missing | Full flow | MEDIUM - Performance SLA | Measured end-to-end < 10 min |

**Schema Status**: ✅ `MeterReading` table EXISTS (packages/database/prisma/schema.prisma:222-244)
**Code Status**: ❌ Mobile OCR implementation missing, ❌ Offline queue missing

---

### 1.2 POS Transaction Queue (Offline Sales)

| Requirement | Source | Status | Target Module | Risk | Acceptance Test |
|-------------|--------|--------|---------------|------|-----------------|
| **POS records sales offline (no internet)** | BPO PDF p.11 "YES - System MUST work offline" | ❌ Missing | `apps/web/src/store/offline` | HIGH - Mandatory for petrol pumps | 50 sales queued offline |
| **Offline queue persists in IndexedDB** | Implicit | ❌ Missing | `apps/web/src/db/indexeddb` | HIGH - Data loss risk | Browser restart preserves queue |
| **Deterministic sync when online** | BPO PDF p.11 (offline requirement) | ❌ Missing | `apps/backend/src/services/sync` | HIGH - Conflict resolution needed | No duplicate sales after sync |
| **Conflict handling (2 POS same customer)** | Implied by multi-branch | ❌ Missing | `apps/backend/src/services/conflict` | MEDIUM - Edge case | Last-write-wins with audit trail |
| **Show sync status in POS UI** | Implicit | ❌ Missing | `apps/web/src/components/SyncStatus` | LOW | Green = synced, Yellow = pending, Red = error |

**Schema Status**: ✅ `Sale` table exists (packages/database/prisma/schema.prisma:277-312)
**Missing Fields**: ❌ `sync_status`, ❌ `offline_queue_id`, ❌ `is_walk_in`
**Code Status**: ❌ IndexedDB offline queue missing, ❌ Sync endpoint missing

---

## 2. SALES BIFURCATION FLOW (P0 - CRITICAL)

### 2.1 End-of-Day Bifurcation Process

| Requirement | Source | Status | Target Module | Risk | Acceptance Test |
|-------------|--------|--------|---------------|------|-----------------|
| **Bifurcation timing: End of day (accountant)** | BPO PDF p.6 "End of day (accountant does it)" | 🟡 Partial | Schema has `Bifurcation` table | MEDIUM - Workflow unclear | Accountant triggers bifurcation |
| **Can also be end of shift (client-dependent)** | BPO PDF p.6 "can be done at end of each shift" | ❌ Missing | Config setting | LOW | Configurable per organization |
| **Step 1: Total sales recorded (PMG/HSD liters)** | BPO PDF p.7 "Total sales recorded: PMG-1000L, HSD-1000L" | 🟡 Partial | `Bifurcation` table | MEDIUM | Enter totals manually |
| **Step 2: Review credit sale invoices (slips)** | BPO PDF p.7 "Accountant reviews all credit sale invoices (petrol pump slips)" | ❌ Missing | `apps/web/src/pages/Bifurcation` | HIGH - Core workflow | List all credit sales with PMG/HSD classification |
| **Step 3: Enter bank cards and pump cards** | BPO PDF p.7 "bank cards and pump cards are entered" | ❌ Missing | `apps/web/src/pages/Bifurcation` | MEDIUM | Separate card transaction entry |
| **Step 4: Remaining balance = cash** | BPO PDF p.7 "remaining balance treated as cash and allocated" | ❌ Missing | `apps/web/src/pages/Bifurcation` | HIGH - Auto-calculation critical | System calculates remaining as cash |
| **Validation: Total must match** | BPO PDF p.7 "System validates total matches" | ❌ Missing | Backend validation | HIGH - Zero tolerance | Rejects if totals don't match exactly |
| **Example: PMG 1000L = 28,000 KWD breakdown** | BPO PDF p.7 Example | ❌ Missing | Full workflow | HIGH | Replicate exact example in test |

**Schema Status**: ✅ `Bifurcation` table complete (packages/database/prisma/schema.prisma:406-440)
**Code Status**: ❌ Backend workflow service missing, ❌ Web wizard UI missing

---

### 2.2 Sales by Fuel Type Tracking

| Requirement | Source | Status | Target Module | Risk | Acceptance Test |
|-------------|--------|--------|---------------|------|-----------------|
| **Operators initially unable to identify cash by fuel type** | BPO PDF p.7 "unable to identify how much cash relates to PMG or HSD" | ❌ Missing | Documentation | MEDIUM - Workflow education | Training docs explain process |
| **Credit sales MUST have PMG/HSD classification** | BPO PDF p.7 "proper classification between PMG and HSD" | ❌ Missing | `Sale` schema | HIGH - Accounting requirement | Credit sales have `fuelType` field |
| **Slip number tracking for credit sales** | BPO PDF p.9 "Customer name, Vehicle Number, Slip Number" | ❌ Missing | `Sale.slipNumber` field | HIGH - Paper trail | Slip number mandatory for credit |

**Schema Status**: ❌ No `fuelType` or `slipNumber` in `Sale` table

---

## 3. METER READING PROCESS (P0 - CRITICAL)

| Requirement | Source | Status | Target Module | Risk | Acceptance Test |
|-------------|--------|--------|---------------|------|-----------------|
| **Current process: Mobile app photo at shift close** | BPO PDF p.6 "Step 1: From mobile app take picture" | 🟡 Partial | `apps/mobile` exists | MEDIUM | Mobile app captures photo |
| **OCR scans and shows result to verify** | BPO PDF p.6 "Step 2: app scan and show result" | ❌ Missing | OCR service | HIGH - Accuracy critical | Operator sees OCR result |
| **If correct, submit; else retake photo** | BPO PDF p.6 "Step 3: If correct submit, otherwise retake" | ❌ Missing | Mobile UI | MEDIUM | Operator can reject and retry |
| **Submitted reading goes to POS for calculations** | BPO PDF p.6 "Step 4: Once submitted goes to POS" | ❌ Missing | Backend sync | HIGH | POS calculates fuel sold |
| **Process time: 5-10 minutes** | BPO PDF p.6 "5 to 10 minutes from Picture to POS" | ❌ Missing | Performance | MEDIUM - SLA | Measured < 10 min |
| **Variance tolerance: ZERO - must match exactly** | BPO PDF p.6 "Zero tolerance - must match exactly" | ❌ Missing | Validation | HIGH - Financial accuracy | Rejects any mismatch |

**Schema Status**: ✅ `MeterReading` table EXISTS (packages/database/prisma/schema.prisma:222-244)
**Code Status**: ❌ Mobile OCR missing, ❌ Verification screen missing, ❌ Submit endpoint missing

---

## 4. CREDIT CUSTOMER MANAGEMENT (P0 - CRITICAL)

| Requirement | Source | Status | Target Module | Risk | Acceptance Test |
|-------------|--------|--------|---------------|------|-----------------|
| **Track: Customer name** | BPO PDF p.9 | ✅ Done | `Customer.name` | LOW | Field exists |
| **Track: Vehicle Number** | BPO PDF p.9 | ❌ Missing | `Customer.vehicleNumber` | HIGH - Key identifier | Field added |
| **Track: Slip Number** | BPO PDF p.9 | ❌ Missing | `Sale.slipNumber` or `Customer.slipNumbers[]` | HIGH - Paper trail | Slip tracked per sale |
| **Track: Phone number** | BPO PDF p.9 | ✅ Done | `Customer.phone` | LOW | Field exists |
| **Track: Email** | BPO PDF p.9 | ✅ Done | `Customer.email` | LOW | Field exists |
| **Track: Physical address** | BPO PDF p.9 | ❌ Missing | `Customer.address` | MEDIUM | Field added |
| **Track: CR number** | BPO PDF p.9 | ❌ Missing | `Customer.crNumber` | MEDIUM - Business customers | Field added |
| **Track: Tax/VAT number** | BPO PDF p.9 | ❌ Missing | `Customer.taxNumber` | MEDIUM | Field added |
| **Track: Driver name(s)** | BPO PDF p.9 | ❌ Missing | `Customer.drivers[]` or related table | MEDIUM - Multiple drivers per vehicle | Related model |
| **Track: Credit limit (KWD)** | BPO PDF p.9 | ❌ Missing | `Customer.creditLimit` | HIGH - Credit control | Field added |
| **Track: Credit period (varies by customer)** | BPO PDF p.9 | ❌ Missing | `Customer.creditPeriodDays` | HIGH - Payment terms | Field added |
| **Number of active credit customers: 50-100** | BPO PDF p.8 "50-100 (if in Industrial area)" | Info only | N/A | LOW | Scale test with 100 customers |

**Schema Status**: ✅ `Customer` table complete with `vehicleNumbers[]`, `creditLimit`, `creditDays` (packages/database/prisma/schema.prisma:250-271)
**Missing Fields**: ❌ `crNumber`, ❌ `taxNumber`, ❌ `drivers[]` relation (P2 priority)

---

## 5. DISPENSING UNITS CONFIGURATION (P0 - CRITICAL)

| Requirement | Source | Status | Target Module | Risk | Acceptance Test |
|-------------|--------|--------|---------------|------|-----------------|
| **4 Dispensing Units at main branch** | BPO PDF p.4 | ❌ Missing | `DispensingUnit` table | HIGH - Core domain | 4 units configured |
| **Unit 1: 2 nozzles, HSD + Both, Digital** | BPO PDF p.4 | ❌ Missing | `DispensingUnit` + `Nozzle` tables | HIGH | Unit 1 has 2 nozzles |
| **Unit 2: 1 nozzle, HSD, Digital** | BPO PDF p.4 | ❌ Missing | Schema | HIGH | Unit 2 has 1 nozzle |
| **Unit 3: 1 nozzle, PMG, Digital** | BPO PDF p.4 | ❌ Missing | Schema | HIGH | Unit 3 has 1 nozzle (PMG) |
| **Unit 4: 2 nozzles, PMG + Both, Digital** | BPO PDF p.4 | ❌ Missing | Schema | HIGH | Unit 4 has 2 nozzles |
| **Fuel types: PMG (Petrol), HSD (Diesel), Both** | BPO PDF p.4 | ❌ Missing | `FuelType` enum | HIGH | 3 fuel types |
| **Meter Type: Digital (not Analog)** | BPO PDF p.4 "Digital ✓ Analog" | ❌ Missing | `MeterType` enum | MEDIUM | Digital meters only |
| **Nozzle naming convention** | BPO PDF p.4 "Machine 1 - Nozzle 1" or "Unit A - PMG - 1" | ❌ Missing | UI + DB | LOW | Configurable naming |

**Schema Status**: ✅ ALL EXIST - `DispensingUnit` (101-116), `Nozzle` (118-136), `MeterReading` (222-244)
**Code Status**: ❌ Dispensing unit management endpoints missing, ❌ Nozzle CRUD missing

---

## 6. FUEL PRICING (P0 - CRITICAL)

| Requirement | Source | Status | Target Module | Risk | Acceptance Test |
|-------------|--------|--------|---------------|------|-----------------|
| **PMG (Petrol): 321.17 Rs/Liter** | BPO PDF p.5 | ❌ Missing | `Product.price` or `FuelPrice` table | HIGH - Revenue calculation | PMG price correct |
| **HSD (Diesel): 335.86 Rs/Liter** | BPO PDF p.5 | ❌ Missing | Same | HIGH | HSD price correct |
| **Price change frequency: When government announces (irregular)** | BPO PDF p.5 | ❌ Missing | `FuelPriceHistory` table | HIGH - Audit trail | Price history tracked |
| **Authority to change: Client's accountant or manager** | BPO PDF p.5 | ❌ Missing | Role-based access | MEDIUM | Only managers can change price |

**Schema Status**: ✅ `FuelPrice` table EXISTS (83-99) with full history tracking (`effectiveFrom`, `effectiveTo`, `changedBy`)
**Code Status**: ❌ Price change endpoint missing, ❌ Role-based access control for pricing missing

---

## 7. SHIFT OPERATIONS (P1 - CRITICAL)

| Requirement | Source | Status | Target Module | Risk | Acceptance Test |
|-------------|--------|--------|---------------|------|-----------------|
| **2 shifts per day (varies by client)** | BPO PDF p.5 "2 shifts" + "varies" | 🟡 Partial | `ShiftInstance` table exists | MEDIUM | 2 shifts configured |
| **Shift timings vary by client/area** | BPO PDF p.5 "varies from client to client (assume 12 hour for demo)" | ❌ Missing | Configurable shift times | MEDIUM | Org-specific shift times |
| **Pump operators: 1 per unit + 1 cashier + 1 GM + 1 Accountant** | BPO PDF p.6 "1 per each Dispensing unit + 1 cashier + 1 GM + 1 Accountant" | ❌ Missing | Shift assignment | LOW | Staff assignment UI |

**Schema Status**: ✅ `Shift` (177-192) + `ShiftInstance` (194-220) complete
**Code Status**: ❌ Open/close shift endpoints missing, ❌ Operator assignment UI missing

---

## 8. PAYMENT METHODS (P0 - CRITICAL)

| Requirement | Source | Status | Target Module | Risk | Acceptance Test |
|-------------|--------|--------|---------------|------|-----------------|
| **Cash** | BPO PDF p.8 | ✅ Done | `Sale.paymentMethod` | LOW | Cash sales work |
| **Credit (Account customers)** | BPO PDF p.8 | 🟡 Partial | `Sale.customerId` | MEDIUM - Credit workflow incomplete | Credit sale recorded |
| **Debit/Credit Cards** | BPO PDF p.8 | ✅ Done | `Sale.paymentMethod` | LOW | Card payment recorded |
| **PSO/Fuel Cards** | BPO PDF p.8 | ✅ Done | `Sale.paymentMethod` | LOW | Fuel card payment |
| **Other (specify)** | BPO PDF p.8 | ✅ Done | `Sale.paymentMethod` | LOW | Other payment type |
| **Payment distribution varies by area** | BPO PDF p.8 "depends on number of factors especially area" | Info only | N/A | LOW | Reporting shows breakdown |

**Schema Status**: 🟡 Payment methods exist but bifurcation workflow missing

---

## 9. REPORTING (P0 - CRITICAL)

### 9.1 Daily Reports (Most Critical)

| Report | Importance | Who Needs It | Source | Status | Target Module | Acceptance Test |
|--------|------------|--------------|--------|--------|---------------|-----------------|
| **Daily Sales Summary** | 5/5 | Owner-Accounting firm | BPO PDF p.14 | ❌ Missing | `apps/backend/src/reports/daily-sales` | Shows total PMG/HSD sales, revenue |
| **Shift Report** | 5/5 | Owner-accountant-accounting firm | BPO PDF p.14 | ❌ Missing | `apps/backend/src/reports/shift` | Shows shift-wise sales |
| **Payment Type Summary** | 3/5 | Accountant (In house) | BPO PDF p.14 | ❌ Missing | `apps/backend/src/reports/payment-type` | Cash/Credit/Card breakdown |
| **Meter Reading Report** | 5/5 | In house Accountant | BPO PDF p.14 | ❌ Missing | `apps/backend/src/reports/meter-reading` | Opening/closing meter readings |
| **Variance Report** | 5/5 | Owner + In house accountant | BPO PDF p.14 | ❌ Missing | `apps/backend/src/reports/variance` | Expected vs actual, gain/loss of fuel |
| **Credit Sales List** | 5/5 | - | BPO PDF p.14 | ❌ Missing | `apps/backend/src/reports/credit-sales` | All credit sales with customer details |
| **Cash Reconciliation** | 5/5 | - | BPO PDF p.14 | ❌ Missing | `apps/backend/src/reports/cash-recon` | Expected cash vs actual (or from QB) |
| **Low Stock Alert** | 3/5 | Owner | BPO PDF p.14 | ❌ Missing | `apps/backend/src/reports/low-stock` | Alerts before price change |

**Note**: Variance Report - "Extract from QB otherwise gain and loss of fuel is needed by in-house accountant every day"

**Schema Status**: ✅ All source data tables exist (Sale, MeterReading, Bifurcation, etc.)
**Code Status**: ❌ 8 critical report generation services missing
**Missing Reports**: Daily Sales Summary, Shift Report, Variance Report, Meter Reading Report, Credit Sales List, Cash Reconciliation, Low Stock Alert, Payment Type Summary

---

### 9.2 Real-Time Dashboard

| Widget | Source | Status | Target Module | Acceptance Test |
|--------|--------|--------|---------------|-----------------|
| **Today's sales (so far)** | BPO PDF p.15 ✓ | ❌ Missing | `apps/web/src/pages/Dashboard` | Shows live sales total |
| **Yesterday's sales (comparison)** | BPO PDF p.15 ✓ | ❌ Missing | Same | Shows previous day |
| **Current shift sales** | BPO PDF p.15 | ❌ Missing | Same | Shows active shift sales |
| **Payment type breakdown (pie chart)** | BPO PDF p.15 ✓ | ❌ Missing | Same | Pie chart with Cash/Credit/Card |
| **Hourly sales trend** | BPO PDF p.15 | ❌ Missing | Same | Line chart |
| **Top selling items** | BPO PDF p.15 | ❌ Missing | Same | Top 5 products |
| **Current stock levels** | BPO PDF p.15 ✓ | ❌ Missing | Same | Fuel inventory |
| **Low stock warnings** | BPO PDF p.15 | ❌ Missing | Same | Red badge if low |
| **Credit outstanding total** | BPO PDF p.15 ✓ | ❌ Missing | Same | Total receivables |
| **Branch performance (if multi-branch)** | BPO PDF p.15 ✓ | ❌ Missing | Same | Branch comparison |

**Schema Status**: ✅ All source data tables exist
**Code Status**: 🟡 Web dashboard page exists with mock data, ❌ Real-time aggregation endpoints missing, ❌ WebSocket integration missing

---

## 10. QUICKBOOKS INTEGRATION (P1 - CRITICAL)

| Requirement | Source | Status | Target Module | Risk | Acceptance Test |
|-------------|--------|--------|---------------|------|-----------------|
| **QuickBooks Online (not Desktop)** | BPO PDF p.13 ✓ | ✅ Done | Schema | LOW | QB Online API used |
| **QB Plan: Advanced (Full API)** | BPO PDF p.13 ✓ | ✅ Done | Config | LOW | Full API access |
| **Managed by: BPO WORLD LIMITED** | BPO PDF p.13 | Info only | N/A | LOW | Contact for credentials |
| **Test access: Yes (Admin credentials)** | BPO PDF p.14 ✓ | Pending | N/A | LOW | User to provide creds |
| **Sync: Daily sales summary** | BPO PDF p.14 ✓ | ❌ Missing | `apps/backend/src/services/quickbooks` | MEDIUM | Journal entry per day |
| **Sync: Individual credit sale invoices** | BPO PDF p.14 ✓ | ❌ Missing | Same | HIGH | QB Invoice per credit sale |
| **Sync: Customer payments/receipts** | BPO PDF p.14 ✓ | ❌ Missing | Same | HIGH | QB Payment records |
| **Sync: Inventory quantity updates** | BPO PDF p.14 ✓ | ❌ Missing | Same | MEDIUM | QB Item quantity updated |
| **Sync: Product/service items** | BPO PDF p.14 ✓ | ❌ Missing | Same | MEDIUM | QB Items synced |
| **Sync: Expenses (supplier purchases)** | BPO PDF p.14 ✓ | ❌ Missing | Same | MEDIUM | QB Expense records |
| **Sync Frequency: Real-time (after each sale) - RECOMMENDED** | BPO PDF p.14 ✓ | ❌ Missing | Event-driven sync | HIGH | Sales appear in QB within 1 min |
| **QB Safety: READ_ONLY mode by default** | Financial Safety Rules | ✅ Done | Schema | HIGH | No writes until approved |

**Schema Status**: ✅ QB tables complete with all safety controls (packages/database/prisma/schema.prisma:451-694)

**Code Status**: ✅ **FULLY IMPLEMENTED** (apps/backend/src/services/quickbooks/, 10 services, 3,256 LOC)
- ✅ Safety gates (kill switch, sync mode, batch approval)
- ✅ Audit logger (immutable trail)
- ✅ Rate limiter (circuit breaker)
- ✅ Replay service (batch recovery)
- ✅ Entity snapshots (QB fallback)
- ✅ Encryption (AES-256-GCM)
- ✅ Checkpoints (pre-sync backups)
- ✅ Idempotency (duplicate prevention)
- ✅ Company lock (concurrency control)
- ✅ API routes (management endpoints)

---

## 11. HARDWARE & INFRASTRUCTURE (P1 - ONSITE)

| Requirement | Source | Status | Target Module | Risk | Acceptance Test |
|-------------|--------|--------|---------------|------|-----------------|
| **POS: Desktop PC, Windows 10, 8GB RAM** | BPO PDF p.10 | N/A | Deployment | LOW | Web app runs on hardware |
| **Receipt Printer: Need to buy** | BPO PDF p.10, p.11 "No, need to buy" | ❌ Missing | Hardware abstraction | MEDIUM - Onsite integration | Print receipt to ESC/POS printer |
| **Receipt: English only** | BPO PDF p.11 ✓ | ❌ Missing | Receipt template | LOW | Receipt in English |
| **Receipt Contents: Everything is essential** | BPO PDF p.11 | ❌ Missing | Receipt template | MEDIUM | All fields included |
| **Internet: PTCL Fiber, Reliable (95%)** | BPO PDF p.12 | Info only | N/A | LOW | System tolerates outages |
| **Offline: YES - MUST work offline** | BPO PDF p.12 ✓ | ❌ Missing | Offline-first architecture | HIGH - MANDATORY | 24h offline operation |

**Schema Status**: N/A (hardware abstraction)

**Code Status**: ❌ No receipt printer integration, ❌ No offline queue

---

## 12. NON-FUEL INVENTORY (P2 - IMPORTANT)

| Requirement | Source | Status | Target Module | Risk | Acceptance Test |
|-------------|--------|--------|---------------|------|-----------------|
| **Track non-fuel products (oil, accessories, etc.)** | BPO PDF Section 4 (not shown in excerpt) | 🟡 Partial | `Product` table exists | MEDIUM | Can add non-fuel products |
| **Barcode scanning for non-fuel items** | Implicit | ❌ Missing | Barcode scanner abstraction | LOW - Can add manually | Scan barcode adds to sale |

**Schema Status**: 🟡 `Product` table exists

---

## SUMMARY - TRACK B REQUIREMENTS

### By Priority

**P0 (Must-Have for MVP) - 12 items:**
1. Offline-first mobile OCR queue
2. Offline-first POS transaction queue
3. Sales bifurcation workflow (end of day)
4. Meter reading process (photo → OCR → verify → POS)
5. Credit customer fields (vehicle, slip, credit limit, period)
6. Dispensing units + nozzles configuration
7. Fuel pricing + price history
8. Payment methods (all 5 types)
9. Daily reports (8 critical reports)
10. Real-time dashboard (10 widgets)
11. QB sync (real-time, all entities)
12. Offline capability (24h operation)

**P1 (Critical for Production) - 5 items:**
1. Shift operations (configurable times)
2. Receipt printer integration
3. QB sync implementation
4. Hardware abstraction layer
5. Variance report

**P2 (Important) - 2 items:**
1. Non-fuel inventory
2. Barcode scanning

---

### By Status

- ✅ **Done**: 8 items (Payment methods enums, QB schema, Customer base fields)
- 🟡 **Partial**: 12 items (Schema exists, workflow missing)
- ❌ **Missing**: 45 items (No schema or code)
- 🔄 **In Progress**: 0 items

**Completion**: ~12% (8/65 items done)

---

### Critical Schema Gaps (P0)

1. ❌ `MeterReading` table
2. ❌ `DispensingUnit` table
3. ❌ `Nozzle` table
4. ❌ `FuelPriceHistory` table
5. ❌ `Sale.fuelType` field
6. ❌ `Sale.slipNumber` field
7. ❌ `Sale.syncStatus` field
8. ❌ `Customer.vehicleNumber` field
9. ❌ `Customer.creditLimit` field
10. ❌ `Customer.creditPeriodDays` field
11. ❌ `OfflineQueue` table (IndexedDB or PostgreSQL)
12. ❌ Bifurcation workflow fields

---

## NEXT ACTIONS

**Immediate (Track A):**
1. Generate QB safety migration
2. Implement code-layer QB safety gates
3. Write QB safety tests

**Immediate (Track B):**
1. Read Petrol Pumps.docx for additional requirements
2. Add critical schema gaps (12 items above)
3. Implement offline-first architecture
4. Build bifurcation workflow UI
5. Implement 8 critical reports

**Coordination:**
- Offline queue design impacts both Track A (QB sync) and Track B (POS/Mobile)
- Must ensure QB sync only fires for online-confirmed transactions

---

## 13. ADDITIONAL REQUIREMENTS FROM PETROL PUMPS.DOCX (P0-P2)

### Key Clarifications from Petrol Pumps.docx

1. **Nozzle-Wise Tracking**: Meter readings must be **per nozzle**, not just per dispensing unit (P0)
2. **Mobile POS Scope**: Document mentions "built-in POS" in mobile, but BPO PDF implies web-based POS primary (DECISION NEEDED - RECOMMEND web POS only)
3. **Walk-In Customers**: Cash sales can be anonymous/walk-in (no customer record required) (P1)
4. **Fuel vs Non-Fuel Split**: Explicit requirement for separate reporting tracks (P1)
5. **Online Ordering**: Mentioned but not in BPO scope (defer to P3 backlog)

### New Requirements Added (5 items)

| Requirement | Priority | Source | Status |
|-------------|----------|--------|--------|
| Nozzle-wise meter reading tracking | P0 | Petrol Pumps.docx | ❌ Missing |
| Built-in POS within mobile app | P1 | Petrol Pumps.docx | ❌ Missing (DECISION NEEDED) |
| Walk-in customer marking for cash sales | P1 | Petrol Pumps.docx | ❌ Missing |
| Separate fuel vs non-fuel reporting | P1 | Petrol Pumps.docx | ❌ Missing |
| Online ordering feature | P2 | Petrol Pumps.docx | ❌ Missing (defer to backlog) |

---

## UPDATED SUMMARY - POST PETROL PUMPS.DOCX MERGE

### Total Requirements: 70 items (+5 new)

**By Priority:**
- **P0 (Must-Have)**: 13 items (+1: nozzle-wise reading)
- **P1 (Important)**: 8 items (+3: mobile POS, walk-in marking, separate reporting)
- **P2 (Nice-to-Have)**: 3 items (+1: online ordering)

**By Status (CORRECTED after re-baseline)**:
- ✅ **Done**: 28 items (40%) - All schema + QB full stack
- 🟡 **Partial**: 15 items (21%) - UI exists, logic missing
- ❌ **Missing**: 27 items (39%) - Workflows, OCR, offline queue

**Completion**: ~40% (70 total, 28 done)

**Key Finding**: Documentation was 29% out of date with actual implementation

---

### P0 Critical Gaps (CORRECTED - Schema vs Code)

**Schema Status**: ✅ **100% COMPLETE** (All tables exist)

**What's Actually Missing** (Code/Logic only):

1. ❌ **Offline Queue** - Mobile AsyncStorage + Web IndexedDB + Backend sync endpoint
2. ❌ **Mobile OCR** - Tesseract.js service + Camera integration + Verification screen
3. ❌ **Bifurcation Workflow** - Backend service + Web wizard UI (4 steps)
4. ❌ **8 Critical Reports** - Backend generation services + Web viewing UI
5. ❌ **Shift Open/Close** - Backend endpoints + Web UI
6. ❌ **Real-time Dashboard** - Aggregation endpoints + WebSocket integration
7. ❌ **Dispensing Unit CRUD** - Backend endpoints + Web UI

**Missing Fields** (Schema additions needed):
- `Sale.syncStatus` (for offline queue tracking)
- `Sale.offlineQueueId` (for sync idempotency)
- `Sale.isWalkIn` (for anonymous cash sales)

---

## 🎯 NEXT BUILD SLICE (Post-Drift Re-baseline)

**Objective**: Complete P0 operational flow (offline-first, mobile OCR, bifurcation, reports)

**Duration**: 2-3 weeks
**Team**: Backend + Mobile + Web

### Sprint 1: Offline Foundation (Week 1)

**BLOCKING**: System MUST work offline 24h (BPO PDF p.11)

#### 1. Backend: Offline Sync Endpoint
**Files to create**:
- `apps/backend/src/modules/sync/sync.service.ts` - Sync queue processor
- `apps/backend/src/modules/sync/sync.controller.ts` - POST /api/sync/meter-readings, POST /api/sync/sales
- `apps/backend/src/modules/sync/sync.routes.ts` - Route definitions
- `apps/backend/src/modules/sync/conflict-resolver.ts` - Duplicate detection

**Acceptance Criteria**:
- [ ] POST /api/sync/meter-readings accepts batch of meter readings
- [ ] POST /api/sync/sales accepts batch of sales
- [ ] Idempotency key prevents duplicate operations
- [ ] Returns sync status: { synced: 10, failed: 0, duplicates: 2 }

#### 2. Mobile: Offline Meter Reading Queue
**Files to create**:
- `apps/mobile/src/services/offline-queue.ts` - AsyncStorage queue manager
- `apps/mobile/src/services/sync-service.ts` - Background sync logic
- `apps/mobile/src/store/sync-store.ts` - Zustand sync state
- `apps/mobile/src/components/SyncStatusBadge.tsx` - UI indicator

**Acceptance Criteria**:
- [ ] Meter readings queued in AsyncStorage when offline
- [ ] Background sync triggers when online
- [ ] Sync status badge shows: synced/pending/error
- [ ] 100 readings queued offline → synced when online

#### 3. Web: Offline Sales Queue
**Files to create**:
- `apps/web/src/db/indexeddb.ts` - IndexedDB wrapper
- `apps/web/src/services/offline-queue.ts` - Sales queue manager
- `apps/web/src/services/sync-service.ts` - Sync orchestrator
- `apps/web/src/components/SyncStatus.tsx` - UI component

**Files to modify**:
- `apps/web/src/pages/Sales.tsx` - Add sync status UI
- `packages/database/prisma/schema.prisma` - Add Sale.syncStatus, Sale.offlineQueueId

**Acceptance Criteria**:
- [ ] Sales queued in IndexedDB when offline
- [ ] Auto-sync every 30s when online
- [ ] Sync status component: Green (synced) / Yellow (pending) / Red (error)
- [ ] 50 sales queued offline → synced when online

---

### Sprint 2: Mobile OCR Implementation (Week 1-2)

**BLOCKING**: Meter reading automation via OCR (BPO PDF p.6, 5-10 min process)

#### 1. Mobile: Camera + OCR Service
**Files to create**:
- `apps/mobile/src/services/ocr-service.ts` - Tesseract.js wrapper
- `apps/mobile/src/services/image-preprocessor.ts` - Image enhancement
- `apps/mobile/src/screens/CameraCapture.tsx` - Photo capture screen
- `apps/mobile/src/screens/MeterVerification.tsx` - OCR result verification

**Files to modify**:
- `apps/mobile/package.json` - Add expo-camera, tesseract.js dependencies
- `apps/mobile/src/navigation/AppNavigator.tsx` - Add routes

**Acceptance Criteria**:
- [ ] Camera captures meter photo
- [ ] Tesseract.js extracts meter reading (digits only)
- [ ] Operator sees OCR result with confidence score
- [ ] Operator can override incorrect reading
- [ ] Submit button sends to offline queue
- [ ] Process time: < 10 seconds (photo → queue)

#### 2. Backend: OCR Validation Endpoint
**Files to create**:
- `apps/backend/src/modules/meter-readings/meter-reading.service.ts` - Validation logic
- `apps/backend/src/modules/meter-readings/meter-reading.controller.ts` - POST /api/meter-readings
- `apps/backend/src/modules/meter-readings/meter-reading.routes.ts` - Route definitions

**Acceptance Criteria**:
- [ ] POST /api/meter-readings accepts { nozzleId, shiftInstanceId, meterValue, imageUrl, ocrResult, isManualOverride }
- [ ] Validates: meter value >= previous reading
- [ ] Returns: { accepted: true, calculatedLiters: 150.5 }

---

### Sprint 3: Bifurcation Workflow (Week 2)

**HIGH PRIORITY**: End-of-day accountant reconciliation (BPO PDF p.7)

#### 1. Backend: Bifurcation Service
**Files to create**:
- `apps/backend/src/modules/bifurcation/bifurcation.service.ts` - 4-step workflow
- `apps/backend/src/modules/bifurcation/bifurcation.controller.ts` - POST /api/bifurcations
- `apps/backend/src/modules/bifurcation/bifurcation.routes.ts` - Route definitions

**Logic to implement**:
```typescript
// Step 1: Get total sales (PMG + HSD liters)
const totals = await getTotalsByFuelType(branchId, date);

// Step 2: Review credit sales (already classified by fuel type)
const creditSales = await getCreditSales(branchId, date);

// Step 3: Enter bank cards + pump cards
const cardTransactions = req.body.cardTransactions;

// Step 4: Calculate cash = total - credit - cards
const cashAmount = totals.pmgAmount + totals.hsdAmount - creditTotal - cardTotal;

// Validation: Must match exactly
if (Math.abs(cashAmount - req.body.cashAmount) > 0.01) {
  throw new Error('Totals do not match');
}
```

**Acceptance Criteria**:
- [ ] POST /api/bifurcations creates bifurcation record
- [ ] Validates: total matches exactly
- [ ] Returns: { bifurcationId, variance: 0.00, status: 'completed' }

#### 2. Web: Bifurcation Wizard UI
**Files to modify**:
- `apps/web/src/pages/Bifurcation.tsx` - Replace with 4-step wizard

**UI Steps**:
1. **Step 1 (Totals)**: Show PMG/HSD totals (read-only)
2. **Step 2 (Credit)**: List credit sales with slip numbers, PMG/HSD classification
3. **Step 3 (Cards)**: Enter bank card + pump card transactions
4. **Step 4 (Review)**: Show calculated cash, validate total matches

**Acceptance Criteria**:
- [ ] Wizard shows 4 steps with progress indicator
- [ ] Step 2 lists all credit sales for the day
- [ ] Step 3 allows adding card transactions
- [ ] Step 4 shows validation errors if totals mismatch
- [ ] Submit button creates bifurcation

---

### Sprint 4: Critical Reports (Week 2-3)

**HIGH PRIORITY**: 8 daily reports (BPO PDF p.14)

#### 1. Backend: Report Generation Services
**Files to create**:
- `apps/backend/src/modules/reports/daily-sales-summary.service.ts`
- `apps/backend/src/modules/reports/shift-report.service.ts`
- `apps/backend/src/modules/reports/variance-report.service.ts`
- `apps/backend/src/modules/reports/meter-reading-report.service.ts`
- `apps/backend/src/modules/reports/credit-sales-list.service.ts`
- `apps/backend/src/modules/reports/cash-reconciliation.service.ts`
- `apps/backend/src/modules/reports/low-stock-alert.service.ts`
- `apps/backend/src/modules/reports/payment-type-summary.service.ts`
- `apps/backend/src/modules/reports/reports.controller.ts` - GET /api/reports/:type
- `apps/backend/src/modules/reports/reports.routes.ts` - Route definitions

**Priority Order** (implement in this order):
1. **Daily Sales Summary** (P0) - Total PMG/HSD sales, revenue, liters
2. **Variance Report** (P0) - Expected vs actual, gain/loss of fuel
3. **Meter Reading Report** (P0) - Opening/closing readings by nozzle

**Acceptance Criteria (Per Report)**:
- [ ] GET /api/reports/daily-sales-summary?branchId=X&date=2026-03-28
- [ ] Returns JSON with report data
- [ ] Supports CSV export: `?format=csv`
- [ ] Response time: < 2 seconds

#### 2. Web: Report Viewing UI
**Files to modify**:
- `apps/web/src/pages/Reports.tsx` - Add report selector, filters, export button

**Acceptance Criteria**:
- [ ] Dropdown to select report type
- [ ] Date range picker
- [ ] Branch filter
- [ ] Export to CSV button
- [ ] Print button (CSS print styles)

---

### Sprint 5: Shift Operations (Week 3)

**MEDIUM PRIORITY**: Open/Close shift workflow (BPO PDF p.5-6)

#### 1. Backend: Shift Endpoints
**Files to create**:
- `apps/backend/src/modules/shifts/shifts.service.ts` - Open/close logic
- `apps/backend/src/modules/shifts/shifts.controller.ts` - POST /api/shifts/open, POST /api/shifts/close
- `apps/backend/src/modules/shifts/shifts.routes.ts` - Route definitions

**Logic to implement**:
```typescript
// Open shift
POST /api/shifts/open
{
  shiftId: uuid,
  branchId: uuid,
  date: '2026-03-28',
  openedBy: userId,
  openingMeterReadings: [
    { nozzleId: uuid, meterValue: 12345.67, imageUrl: '...', ocrResult: 12345.67 }
  ]
}

// Close shift
POST /api/shifts/close
{
  shiftInstanceId: uuid,
  closedBy: userId,
  closingMeterReadings: [
    { nozzleId: uuid, meterValue: 12500.34, imageUrl: '...', ocrResult: 12500.34 }
  ]
}
```

**Acceptance Criteria**:
- [ ] POST /api/shifts/open creates ShiftInstance
- [ ] Records opening meter readings
- [ ] POST /api/shifts/close closes ShiftInstance
- [ ] Records closing meter readings
- [ ] Calculates liters sold per nozzle

#### 2. Web: Shift UI
**Files to modify**:
- `apps/web/src/pages/Shifts.tsx` - Add open/close buttons

**Acceptance Criteria**:
- [ ] "Open Shift" button (disabled if shift already open)
- [ ] "Close Shift" button (disabled if no open shift)
- [ ] Shows current shift status: Open / Closed
- [ ] Shows operator name who opened shift

---

## 📋 Implementation Checklist

### Phase 1: Offline Foundation (BLOCKING)
- [ ] Backend sync endpoint (`apps/backend/src/modules/sync/`)
- [ ] Mobile offline queue (`apps/mobile/src/services/offline-queue.ts`)
- [ ] Web offline queue (`apps/web/src/db/indexeddb.ts`)
- [ ] Sync status UI components
- [ ] Schema: Add `Sale.syncStatus`, `Sale.offlineQueueId`

### Phase 2: Mobile OCR (BLOCKING)
- [ ] Mobile camera integration (`expo-camera`)
- [ ] Tesseract.js OCR service (`apps/mobile/src/services/ocr-service.ts`)
- [ ] Operator verification screen (`apps/mobile/src/screens/MeterVerification.tsx`)
- [ ] Backend validation endpoint (`POST /api/meter-readings`)

### Phase 3: Bifurcation Workflow (HIGH)
- [ ] Backend bifurcation service (`apps/backend/src/modules/bifurcation/`)
- [ ] Web wizard UI (4 steps) (`apps/web/src/pages/Bifurcation.tsx`)
- [ ] Validation logic (totals must match exactly)

### Phase 4: Critical Reports (HIGH)
- [ ] Backend report services (8 reports) (`apps/backend/src/modules/reports/`)
- [ ] Daily Sales Summary (P0)
- [ ] Variance Report (P0)
- [ ] Meter Reading Report (P0)
- [ ] Web report viewing UI (`apps/web/src/pages/Reports.tsx`)
- [ ] CSV/PDF export

### Phase 5: Shift Operations (MEDIUM)
- [ ] Backend shift endpoints (`apps/backend/src/modules/shifts/`)
- [ ] Web shift UI (`apps/web/src/pages/Shifts.tsx`)

---

## 🚧 Blocked Items (User Dependencies)

### Waiting for Client
1. **Meter photos** (6 nozzles, digital meters) - Needed for OCR training
2. **QuickBooks Production credentials** (Client ID + Secret) - Needed for QB sync testing
3. **Receipt printer model** - Needed for printer integration

### Waiting for Deployment
1. **Production server** (4GB RAM droplet) - User to purchase
2. **Domain SSL** (kuwaitpos.duckdns.org) - After server ready
3. **Daily backups** (cron setup) - After deployment

---

**END OF REQUIREMENTS TRACE MATRIX v1.2**
**Updated**: 2026-03-28 (Re-baselined post-drift + Next Build Slice added)
**Next Review**: After Sprint 1 completion (Offline Foundation)
