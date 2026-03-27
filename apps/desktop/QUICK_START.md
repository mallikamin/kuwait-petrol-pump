# Kuwait Petrol POS Desktop - Quick Start Guide

## Installation (5 minutes)

### 1. Prerequisites Check
```bash
node --version  # Should be 18+
npm --version   # Should be 9+
```

### 2. Install Dependencies
```bash
cd "C:/ST/Sitara Infotech/Kuwait Petrol Pump/kuwait-petrol-pump/apps/desktop"
npm install
```

### 3. Configure Environment
```bash
# Copy example env file
cp .env.example .env

# Edit if needed (default works with local backend)
# VITE_API_URL=http://localhost:3000/api
```

## Running the App (2 steps)

### Step 1: Start Backend API
```bash
# In a separate terminal
cd "C:/ST/Sitara Infotech/Kuwait Petrol Pump/kuwait-petrol-pump/apps/backend"
npm run dev

# Wait for: "Server running on http://localhost:3000"
```

### Step 2: Start Desktop App
```bash
# In desktop directory
cd "C:/ST/Sitara Infotech/Kuwait Petrol Pump/kuwait-petrol-pump/apps/desktop"
npm run dev

# Electron window will open automatically
```

## First Login (30 seconds)

1. **Electron window opens** → Login screen appears
2. **Click "cashier"** quick login button (or use admin/manager)
3. **Automatically logged in** → Redirects to Dashboard

**Demo Credentials:**
- Admin: `admin@petrolpump.com` / `password123`
- Manager: `manager@petrolpump.com` / `password123`
- Cashier: `cashier@petrolpump.com` / `password123`
- Operator: `operator@petrolpump.com` / `password123`
- Accountant: `accountant@petrolpump.com` / `password123`

## Quick Workflow Test (3 minutes)

### Test 1: Open a Shift
1. Click **"Shift Management"** in sidebar
2. Select a shift from dropdown (e.g., "Morning Shift")
3. Click **"Open Shift"**
4. ✅ Green "Shift Active" badge appears in header

### Test 2: Record Meter Reading
1. Click **"Meter Readings"** in sidebar
2. Click on any nozzle card
3. Select **"Opening"** reading type
4. Enter meter value: `314012.50`
5. Click **"Record Reading"**
6. ✅ Reading appears in the list

### Test 3: Make a Fuel Sale
1. Click **"Fuel Sales"** in sidebar
2. Click on any nozzle card to select it
3. Enter liters: `50`
4. Amount auto-calculates
5. Select payment method: **Cash**
6. Click **"Record Sale"**
7. ✅ Toast notification: "Fuel sale recorded successfully"

### Test 4: Make a Non-Fuel Sale
1. Click **"Non-Fuel POS"** in sidebar
2. Type in search: `oil` (wait 1 second)
3. Click **+ button** on a product to add to cart
4. Adjust quantity using **+/-** buttons
5. Select payment method
6. Click **"Complete Sale"**
7. ✅ Cart clears, toast notification appears

### Test 5: View Dashboard
1. Click **"Dashboard"** in sidebar
2. ✅ See today's sales stats
3. ✅ Payment breakdown
4. ✅ Current fuel prices
5. Data auto-refreshes every 30 seconds

## Key Features to Explore

### Navigation
- **Sidebar**: Click any screen to navigate
- **Role-based**: Menu items change based on your role
- **Active Shift**: Green badge shows current shift

### Dashboard
- Real-time sales summary
- Payment breakdown
- Low-stock alerts
- Fuel prices

### Fuel Sales
- Select nozzle → Enter liters or amount
- Auto-calculation
- Print receipt (IPC ready)

### Non-Fuel POS
- Barcode scanner ready (press Enter in search)
- Shopping cart
- Tax and discount support

### Shift Management
- Open/close shifts
- Real-time timer
- Shift summary with sales

### Meter Readings
- Opening/closing readings per nozzle
- Variance calculation
- Image upload support (for OCR)

### Customers
- Add/edit customers
- Credit limits
- Vehicle numbers
- Search by name/phone/email

### Products
- Product catalog
- Low stock alerts
- Barcode support
- Category management

## Troubleshooting

### Issue: Electron won't start
```bash
# Solution 1: Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Solution 2: Clear cache
npm run build
```

### Issue: "Cannot connect to API"
```bash
# Check backend is running
curl http://localhost:3000/api/branches

# If not running, start backend:
cd apps/backend
npm run dev
```

### Issue: "Login failed"
```bash
# Verify backend has seeded data
cd apps/backend
npx prisma db seed

# Try demo credentials again
```

### Issue: White screen / blank page
```bash
# Open DevTools (Ctrl+Shift+I)
# Check Console tab for errors
# Check Network tab for failed requests
```

### Issue: TypeScript errors
```bash
# Check for missing types
npx tsc --noEmit

# If errors, verify all imports exist
```

## Building for Production

### Development Build
```bash
npm run build
# Output: dist-electron/ and dist/
```

### Windows Installer
```bash
npm run package:win
# Output: dist/Kuwait Petrol POS Setup.exe
```

### macOS App
```bash
npm run package:mac
# Output: dist/Kuwait Petrol POS.dmg
```

### Linux AppImage
```bash
npm run package:linux
# Output: dist/Kuwait Petrol POS.AppImage
```

## Keyboard Shortcuts

- `Ctrl+Shift+I`: Open DevTools (development)
- `Ctrl+R`: Reload app (development)
- `F11`: Toggle fullscreen
- `Ctrl+Q`: Quit application
- `Enter` in barcode field: Add product to cart

## File Structure Reference

```
apps/desktop/
├── src/
│   ├── main/           # Electron main process
│   ├── preload/        # IPC bridge
│   ├── renderer/       # React app
│   │   ├── api/        # API client
│   │   ├── components/ # UI components
│   │   ├── screens/    # Main screens
│   │   ├── store/      # Zustand stores
│   │   └── utils/      # Utilities
│   └── shared/         # TypeScript types
├── index.html
├── package.json
└── electron.vite.config.ts
```

## Next Steps

1. ✅ **Explore all screens** - Click through sidebar
2. ✅ **Test workflows** - Open shift → Make sales → Close shift
3. ✅ **Check reports** - View dashboard stats
4. ✅ **Manage inventory** - Add products, customers
5. 📝 **Implement Reports screen** - Generate PDF reports
6. 📝 **Implement Bifurcation** - Daily reconciliation
7. 📝 **Implement Settings** - Printer setup, preferences
8. 📝 **Add thermal printer** - ESC/POS integration
9. 📝 **Add OCR service** - Meter reading automation

## Support

For issues or questions:
- Check `README.md` for detailed documentation
- Check `DESKTOP_APP_SUMMARY.md` for complete feature list
- Review console logs in DevTools (Ctrl+Shift+I)
- Verify backend API is running and accessible

---

**Status**: ✅ Production Ready (Core Features)
**Version**: 1.0.0
**Last Updated**: March 26, 2026

**Happy Testing! 🚀**
