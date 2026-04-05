# Client Feedback - PSO POS
**Date**: 2026-04-02
**Source**: C:\Users\Malik\Downloads\PSO POS.docx

---

## 1. Nozzles
- ✅ **SKIP**: "Increase dispensing units (4) and nozzles (6)" - Already configured in DB

---

## 2. Meter Readings
### Requirements:
1. ⏳ **Date range filter** to view previous dates' readings
2. ⏳ **Better layout**: Same nozzle opening → closing → differential in columns (not separate rows)
   - Show: Opening | Closing | Differential (Liters Sold)
3. ⏳ **Attachment column** for picture/evidence upload (with/without OCR)

### Status: NOT IMPLEMENTED

---

## 3. Sales
### Requirements:
1. ⏳ **Date filter** on sales page
2. ⚠️ **Filter tab not opening** - Need to investigate

### Status: NEEDS INVESTIGATION

---

## 4. Customers
- ✅ **DONE**: "Edit customer details" - Just implemented in commit 479a393
- View Details button now opens edit dialog with full CRUD

---

## 5. Bifurcation
### Issue:
- ⚠️ **Both tabs not clickable** - Need to investigate

### Status: NEEDS INVESTIGATION

---

## 6. Products
### Requirements:
1. ⏳ **Add product option** - Check if exists
2. ⏳ **Change prices of Non-Fuel items**

### Status: NEEDS CHECK + IMPLEMENTATION

---

## 7. Reports

### A. Fuel Price History Report
- ⏳ **NEW**: Date range filter for fuel price history

### B. Customer Ledger Enhancements
**Current**: Unknown
**Required Columns**:
- Date
- Customer Name
- Vehicle No.
- Slip No.
- Product
- Rate
- Quantity
- Total Price
- Amount Received
- **Running Balance** ← Key feature

### C. Sale Report Enhancements
**Required**:
- Date range filter
- **Separated sections**: HSD | PMG | Non-Fuel Items
- Totals for each section
- Grand total
- **Summary by Payment Type**: Cash, Credit, PSO Card

### Status: NEEDS MAJOR WORK

---

## 8. POS (Critical Changes)

### A. Remove Nozzles Tab
- ❌ **Current**: Has nozzle selection in POS
- ✅ **Required**: Remove (can't identify which nozzle relates to customer sale)

### B. Add Liters Counter (Top of Page)
- ⏳ **NEW FEATURE**: Show total liters available (PMG + HSD)
- Auto-subtract when sale is entered
- Accountant verifies end balance = zero

### C. Show Posted Entries for Date
- ⏳ **CRITICAL**: Display already posted sales for current date
- **Reason**: 40-60+ entries per day, page refreshes, electricity issues
- Prevent duplicate entry

### D. Bulk Entry Interface
- ⏳ **ENHANCEMENT**: Better interface for:
  - Single customer
  - Multiple vehicles
  - Multiple slip numbers
  - Same date
- Current: Must post each sale separately (inefficient)

### Status: NEEDS MAJOR REDESIGN

---

## Implementation Priority

### PHASE 1: Critical Fixes (Do First)
1. ✅ Check Bifurcation page - why tabs not clickable
2. ✅ Check Sales filter - why not opening
3. ✅ Check Products - Add button clickable?

### PHASE 2: POS Enhancements (High Priority)
1. ⏳ Remove Nozzles tab from POS
2. ⏳ Add liters counter (PMG/HSD totals)
3. ⏳ Show posted entries for date (prevent duplicates)
4. ⏳ Bulk entry interface design

### PHASE 3: Reports (Medium Priority)
1. ⏳ Customer Ledger with running balance
2. ⏳ Sale Report with sections (HSD/PMG/Non-Fuel)
3. ⏳ Fuel Price History report

### PHASE 4: Meter Readings (Medium Priority)
1. ⏳ Date range filter
2. ⏳ Better column layout
3. ⏳ Attachment upload column

### PHASE 5: Products (Low Priority)
1. ⏳ Add product functionality
2. ⏳ Edit non-fuel item prices

---

## UAT Plan
- Implement features in phases
- Test each feature one by one before moving to next
- Client will verify functionality after each implementation

---

**Next Steps**:
1. Investigate broken UI elements (Bifurcation, Sales filter, Products)
2. Implement Phase 1 critical fixes
3. Move to Phase 2 POS enhancements
