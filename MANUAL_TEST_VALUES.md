# Kuwait Petrol Pump - Manual Testing Guide

## ✅ BACKEND VALIDATION COMPLETE

All APIs tested and working:
- ✅ Authentication
- ✅ Meter Readings (Opening & Closing)
- ✅ Fuel Sales (Cash, Card, Credit)
- ✅ Bifurcation Summary
- ✅ Database Reconciliation

---

## 📊 TEST DATA SUMMARY

### Meter Readings (April 2, 2026)

| Nozzle | Fuel Type | Opening    | Closing    | Differential |
|--------|-----------|------------|------------|--------------|
| 1      | HSD       | 1,000,000L | 1,000,500L | **500L**     |
| 2      | HSD       | 1,050,000L | 1,050,600L | **600L**     |
| 3      | HSD       | 1,100,000L | 1,100,700L | **700L**     |
| 4      | PMG       | 2,000,000L | 2,000,800L | **800L**     |
| 5      | PMG       | 2,050,000L | 2,050,900L | **900L**     |
| 6      | PMG       | 2,100,000L | 2,101,000L | **1,000L**   |

**Total HSD Sold**: 1,800L (500 + 600 + 700)
**Total PMG Sold**: 2,700L (800 + 900 + 1,000)

---

### Fuel Prices

- **PMG** (Premium Gasoline): PKR 321.17 per liter
- **HSD** (High Speed Diesel): PKR 335.86 per liter

---

### Sales Transactions (6 Total)

#### HSD Sales
1. **Cash**: 720L @ PKR 335.86 = **PKR 241,819**
2. **Card**: 630L @ PKR 335.86 = **PKR 211,592**
3. **Credit**: 450L @ PKR 335.86 = **PKR 151,137**

#### PMG Sales
4. **Cash**: 1,080L @ PKR 321.17 = **PKR 346,864**
5. **Card**: 945L @ PKR 321.17 = **PKR 303,506**
6. **Credit**: 675L @ PKR 321.17 = **PKR 216,790**

---

### Payment Method Breakdown

| Payment Method | Amount (PKR) | Percentage |
|----------------|--------------|------------|
| **Cash**       | 588,683      | 40%        |
| **Card**       | 515,098      | 35%        |
| **Credit**     | 367,927      | 25%        |
| **TOTAL**      | **1,471,708**| 100%       |

---

## 📋 BIFURCATION SUMMARY

### Meter Readings vs POS Sales
- **PMG from Meters**: 2,700L × PKR 321.17 = **PKR 867,159**
- **PMG from POS**: 2,700L × PKR 321.17 = **PKR 867,159** ✅
- **HSD from Meters**: 1,800L × PKR 335.86 = **PKR 604,548**
- **HSD from POS**: 1,800L × PKR 335.86 = **PKR 604,548** ✅

### Variance
- **PMG Lag**: 0 liters (0 PKR) ✅ Perfect Match
- **HSD Lag**: 0 liters (0 PKR) ✅ Perfect Match
- **Total Lag**: 0 PKR ✅ Perfect Reconciliation

### Cash Register
- **Expected Cash**: PKR 588,683 (from cash sales)
- **Actual Cash**: PKR 588,683
- **Variance**: PKR 0 ✅

---

## 🧪 MANUAL TESTING STEPS

### 1. Login to Web Dashboard
```
URL: https://kuwaitpos.duckdns.org
Username: admin
Password: AdminPass123
```

### 2. Navigate to "Meter Readings" Tab
- You should see 12 readings (6 opening + 6 closing)
- Verify the values match the table above
- Check timestamps are from today (2026-04-02)

### 3. Navigate to "POS" Tab
- Click on "Sales History" or view today's sales
- You should see 6 fuel sales transactions
- Verify payment methods: 2 cash, 2 card, 2 credit
- Verify amounts match the table above

### 4. Navigate to "Bifurcation" Tab
- Select date: **April 2, 2026**
- Click "Generate Summary" or it auto-loads
- **Verify:**
  - Total Sales: PKR 1,471,708
  - PMG: 2,700L = PKR 867,159
  - HSD: 1,800L = PKR 604,548
  - Variance: 0L (perfect match)
  - Cash: PKR 588,683
  - Card: PKR 515,098
  - Credit: PKR 367,927

### 5. Test OCR Meter Reading
- Go to "Meter Readings"
- Click "Record Reading"
- Choose "Upload Photo" or "Camera"
- Upload a meter photo
- Verify OCR extracts the number
- Approve or revise
- Select nozzle and shift
- Check audit trail shows:
  - Your username
  - Timestamp
  - OCR confidence %
  - Photo attached

---

## 📌 EXPECTED BEHAVIORS

### ✅ What Should Work
1. **Meter readings** show opening and closing for all 6 nozzles
2. **Sales** show correct payment breakdowns
3. **Bifurcation** shows zero variance (perfect reconciliation)
4. **OCR** extracts meter readings from photos (7-digit minimum)
5. **Audit trail** shows who entered, when, and how (OCR vs Manual)

### ⚠️ Validation Rules
- Cannot submit duplicate opening/closing for same nozzle in same shift
- Meter reading must be ≥ 1,000,000 (7 digits minimum)
- Closing reading must be > opening reading
- All sales must have valid payment method
- All sales must have valid branch ID and shift

---

## 🔍 TESTING CHECKLIST

- [ ] Login works
- [ ] Meter Readings tab shows 12 readings
- [ ] All nozzles have opening and closing
- [ ] POS tab shows 6 sales
- [ ] Sales amounts match expected values
- [ ] Bifurcation shows PKR 1,471,708 total
- [ ] Bifurcation shows 0 variance
- [ ] Payment breakdown: 40% cash, 35% card, 25% credit
- [ ] OCR meter reading works (upload photo)
- [ ] OCR shows confidence percentage
- [ ] Can approve/revise OCR reading
- [ ] Audit trail shows timestamp and user
- [ ] Validation prevents duplicate readings
- [ ] Validation enforces 7-digit minimum

---

## 🐛 IF SOMETHING DOESN'T WORK

1. **Hard-refresh browser**: `Ctrl + Shift + R`
2. **Check build version**: Should show commit `758370d` or later
3. **Check backend logs**: `ssh root@64.226.65.80 "cd ~/kuwait-pos && docker compose -f docker-compose.prod.yml logs backend --tail 50"`
4. **Check database**: Values should match the tables above

---

## 🎯 SUCCESS CRITERIA

- ✅ All 12 meter readings visible
- ✅ All 6 sales transactions visible
- ✅ Bifurcation shows zero variance
- ✅ Total sales = PKR 1,471,708
- ✅ Cash = PKR 588,683
- ✅ OCR extracts meter readings from photos
- ✅ 7-digit validation works
- ✅ Audit trail complete

**If all checkboxes pass → System ready for production!** 🚀
