# UAT Testing - Quick Start Guide
**Date**: 2026-04-01
**Environment**: Production (64.226.65.80)

---

## 🎯 **YOUR 3-STEP UAT PROCESS**

### **Step 1: Test Web App Login & Dashboard** (2 minutes)

**Open Browser**:
- URL: http://64.226.65.80/
- Username: `admin`
- Password: `AdminPass123`

**What to Check**:
1. Does login work? ✅ / ❌
2. Does dashboard load? ✅ / ❌
3. Any errors in console (F12)? ✅ / ❌

**Report**: "Dashboard OK" or describe the error

---

### **Step 2: Test Meter Readings** (3 minutes)

**Navigate**:
- Click "Meter Readings" in sidebar (or similar menu)

**What to Check**:
1. Can you see the meter reading form? ✅ / ❌
2. Are dropdown fields populated (Shift, Nozzle)? ✅ / ❌
3. Can you submit a reading? ✅ / ❌

**If dropdowns are empty**:
- This is expected - we need to create shifts/nozzles first
- Report: "Need to create shifts/nozzles"

**Report**: What you see

---

### **Step 3: Test History/Reports** (1 minute)

**Navigate**:
- Click "History" or "Reports" in sidebar

**What to Check**:
1. Does the page load? ✅ / ❌
2. Any data displayed (or empty state)? ✅ / ❌

**Report**: "History page OK" or describe issue

---

## 📞 **After Testing - Report Format**

**Paste this and fill in**:
```
UAT Results:

✅ Test 1 (Login & Dashboard): [PASS/FAIL] - [notes]
✅ Test 2 (Meter Readings): [PASS/FAIL] - [notes]
✅ Test 3 (History): [PASS/FAIL] - [notes]

Issues Found:
- [List any errors or problems]

Next Steps:
- [What should we do next?]
```

---

## 🚀 **Monitor Backend While Testing**

**Optional** - Open a second terminal:
```bash
ssh root@64.226.65.80 "docker logs -f kuwaitpos-backend"
```

This shows real-time backend logs to catch any errors.

---

## ⚡ **Quick Health Check Command**

```bash
curl http://64.226.65.80/api/health
```

Expected: `{"status":"ok","timestamp":"...","uptime":...}`

---

**Start with Test 1 and report back. Then we'll proceed to Test 2!** 🧪
