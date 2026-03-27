# Quick Start Guide

## Get Running in 3 Steps

### Step 1: Install Dependencies
```bash
cd apps/web
pnpm install
```

Expected output:
```
Progress: resolved XXX, reused XXX, downloaded X, added XXX
Done in Xs
```

### Step 2: Setup Environment
```bash
# Copy environment file
cp .env.example .env

# The default values will work for local development:
# VITE_API_URL=http://localhost:8000
# VITE_WS_URL=ws://localhost:8000
```

### Step 3: Start Development Server
```bash
pnpm dev
```

Expected output:
```
  VITE v5.1.4  ready in XXX ms

  ➜  Local:   http://localhost:3000/
  ➜  Network: use --host to expose
  ➜  press h to show help
```

### Step 4: Open Browser

Navigate to: **http://localhost:3000**

You should see the login page!

## Default Login Credentials

For testing (when backend is ready):
- Username: `admin`
- Password: `admin123`

## Verify Installation

After starting the dev server, you should see:

1. ✅ **Login Page** - Beautiful login screen with Kuwait Petrol Pump branding
2. ✅ **No Console Errors** - Check browser console (F12)
3. ✅ **Hot Reload Works** - Edit any file and see changes instantly

## Project Structure Overview

```
apps/web/
├── src/
│   ├── api/           # 13 API modules
│   ├── components/    # 32+ components
│   ├── pages/         # 12 pages
│   ├── store/         # State management
│   ├── hooks/         # Custom hooks
│   ├── types/         # TypeScript types
│   ├── utils/         # Utilities
│   └── App.tsx        # Main app
├── public/            # Static assets
└── package.json       # Dependencies
```

## Available Pages

Once logged in, you can navigate to:

- `/` - Dashboard (real-time stats and charts)
- `/branches` - Branch management
- `/fuel-prices` - Fuel price management
- `/shifts` - Shift operations
- `/meter-readings` - Meter reading verification
- `/sales` - Sales transactions
- `/customers` - Customer management
- `/products` - Product & inventory
- `/bifurcation` - Cash reconciliation
- `/reports` - Business reports
- `/users` - User management (admin only)

## Features to Test

### Dashboard
- Real-time statistics cards
- Sales charts
- Payment method pie chart
- Recent transactions
- Low stock alerts
- Top customers

### Theme
- Click moon/sun icon in top bar to toggle dark mode
- Theme preference is saved

### Navigation
- Click hamburger icon to collapse/expand sidebar
- Breadcrumbs update automatically
- Role-based menu items

### Tables
- Pagination controls
- Loading skeletons
- Empty states

## Common Issues

### Port 3000 already in use
```bash
# Change port in vite.config.ts or use:
pnpm dev --port 3001
```

### Module not found errors
```bash
# Reinstall dependencies
rm -rf node_modules
pnpm install
```

### TypeScript errors
```bash
# Check TypeScript
pnpm type-check
```

### ESLint errors
```bash
# Run linter
pnpm lint
```

## Build for Production

```bash
# Create production build
pnpm build

# Preview production build
pnpm preview
```

The build output will be in `dist/` folder.

## Next Steps

1. ✅ Verify all pages load
2. ✅ Test dark mode toggle
3. ✅ Check responsive design (resize browser)
4. ✅ Open browser console - no errors should appear
5. 🔜 Connect to backend API (update VITE_API_URL)
6. 🔜 Test with real data
7. 🔜 Deploy to production

## Need Help?

- Check `README.md` for overview
- Check `SETUP_GUIDE.md` for detailed documentation
- Check `BUILD_SUMMARY.md` for what was built

## Development Tips

### Hot Reload
- Save any file to see changes instantly
- No page refresh needed (most of the time)

### VS Code Extensions (Recommended)
- ESLint
- Tailwind CSS IntelliSense
- TypeScript Vue Plugin (Volar)
- Prettier

### Browser DevTools
- F12 - Open DevTools
- React DevTools extension
- Network tab - Check API calls
- Console tab - Check for errors

---

**Status**: ✅ Ready to Run
**Time to First Render**: < 30 seconds (after install)
**Enjoy!** 🚀
