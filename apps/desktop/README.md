# Kuwait Petrol POS - Desktop Application

A modern, feature-rich desktop Point of Sale (POS) application built with Electron, React, and TypeScript for managing petrol pump operations in Kuwait.

## Features

### Core Functionality
- **Authentication & Authorization**: Role-based access control (Admin, Manager, Cashier, Operator, Accountant)
- **Dashboard**: Real-time sales overview, fuel prices, low-stock alerts
- **Fuel Sales**: Quick fuel dispensing transactions with nozzle selection
- **Non-Fuel POS**: Full-featured retail POS with barcode scanning, cart management
- **Shift Management**: Open/close shifts, track shift duration and sales
- **Meter Readings**: Record opening/closing readings with variance calculations
- **Customers**: Manage customer database with credit limits
- **Products & Inventory**: Product catalog with stock level management
- **Reports**: Comprehensive sales, shift, variance, and inventory reports
- **Bifurcation**: Daily sales reconciliation and verification

### Technical Features
- **Offline Detection**: Visual indicators when connection is lost
- **Auto Token Refresh**: Seamless JWT token renewal
- **Real-time Updates**: Auto-refreshing dashboard data every 30 seconds
- **Receipt Printing**: Thermal printer integration ready
- **Responsive Design**: Optimized for desktop screens (1280px+)
- **Loading States**: Clear feedback during API operations
- **Error Handling**: User-friendly error messages with toast notifications
- **Form Validation**: Comprehensive input validation
- **State Management**: Zustand for efficient state handling
- **Data Caching**: React Query for smart API caching

## Tech Stack

- **Framework**: Electron 29.x
- **Frontend**: React 18 + TypeScript
- **Build Tool**: Vite + electron-vite
- **Styling**: TailwindCSS
- **State Management**: Zustand (with persistence)
- **API Client**: Axios with interceptors
- **Data Fetching**: TanStack Query (React Query)
- **Routing**: React Router v6
- **Forms**: React Hook Form
- **Notifications**: Sonner
- **Icons**: Lucide React
- **Date Utils**: date-fns

## Project Structure

```
apps/desktop/
├── src/
│   ├── main/                 # Electron main process
│   │   └── index.ts          # Main process entry point
│   ├── preload/              # Electron preload scripts
│   │   └── index.ts          # IPC bridge
│   ├── renderer/             # React application
│   │   ├── api/              # API client & endpoints
│   │   │   ├── client.ts     # Axios instance with interceptors
│   │   │   └── endpoints.ts  # API endpoint functions
│   │   ├── components/       # Reusable UI components
│   │   │   ├── ui/           # Base UI components
│   │   │   │   ├── Button.tsx
│   │   │   │   ├── Card.tsx
│   │   │   │   ├── Input.tsx
│   │   │   │   └── Select.tsx
│   │   │   └── Layout.tsx    # App layout with sidebar
│   │   ├── screens/          # Main application screens
│   │   │   ├── Login.tsx
│   │   │   ├── Dashboard.tsx
│   │   │   ├── FuelSales.tsx
│   │   │   ├── NonFuelPOS.tsx
│   │   │   ├── ShiftManagement.tsx
│   │   │   └── MeterReadings.tsx
│   │   ├── store/            # Zustand stores
│   │   │   ├── authStore.ts  # Authentication state
│   │   │   ├── appStore.ts   # App-wide state
│   │   │   └── cartStore.ts  # Shopping cart state
│   │   ├── utils/            # Utility functions
│   │   │   ├── cn.ts         # Class name helper
│   │   │   └── format.ts     # Formatting utilities
│   │   ├── App.tsx           # Root component
│   │   ├── main.tsx          # Renderer entry point
│   │   └── index.css         # Global styles
│   └── shared/               # Shared types
│       └── types.ts          # TypeScript interfaces
├── index.html                # HTML template
├── package.json              # Dependencies
├── electron.vite.config.ts   # Build configuration
├── tailwind.config.js        # Tailwind configuration
├── tsconfig.json             # TypeScript configuration
└── README.md                 # This file
```

## Installation

### Prerequisites
- Node.js 18+ and npm/pnpm
- Backend API running on `http://localhost:3000`

### Setup

1. **Install dependencies:**
   ```bash
   cd apps/desktop
   npm install
   # or
   pnpm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   ```

   Edit `.env`:
   ```env
   VITE_API_URL=http://localhost:3000/api
   NODE_ENV=development
   ```

3. **Run in development:**
   ```bash
   npm run dev
   ```

   This will:
   - Start Vite dev server for renderer
   - Compile Electron main process
   - Launch Electron app with hot reload

## Building

### Development Build
```bash
npm run build
```

### Production Packages

**Windows:**
```bash
npm run package:win
```
Outputs: `dist/Kuwait Petrol POS Setup.exe`

**macOS:**
```bash
npm run package:mac
```
Outputs: `dist/Kuwait Petrol POS.dmg`

**Linux:**
```bash
npm run package:linux
```
Outputs: `dist/Kuwait Petrol POS.AppImage`

## Usage

### Login
Use demo credentials:
- **Admin**: `admin@petrolpump.com` / `password123`
- **Manager**: `manager@petrolpump.com` / `password123`
- **Cashier**: `cashier@petrolpump.com` / `password123`
- **Operator**: `operator@petrolpump.com` / `password123`
- **Accountant**: `accountant@petrolpump.com` / `password123`

### Quick Start Workflow

1. **Login** with appropriate role
2. **Open a Shift** (Shift Management screen)
3. **Record Opening Meter Readings** (Meter Readings screen)
4. **Make Sales**:
   - Fuel Sales: Select nozzle, enter liters/amount, choose payment
   - Non-Fuel POS: Search products, add to cart, checkout
5. **Record Closing Meter Readings** (before closing shift)
6. **Close Shift** (Shift Management screen)
7. **Create Bifurcation** (for daily reconciliation)

### Keyboard Shortcuts

- `Ctrl/Cmd + R`: Refresh (development only)
- `F11`: Toggle fullscreen
- `Ctrl/Cmd + Q`: Quit application
- `Enter` in barcode field: Add product to cart

## API Integration

The desktop app connects to the backend API at `VITE_API_URL`. All endpoints are defined in `src/renderer/api/endpoints.ts`.

### Authentication Flow
1. User logs in via `/api/auth/login`
2. Access token stored in Zustand (persisted to localStorage)
3. Token attached to all requests via Axios interceptor
4. Auto-refresh on 401 errors using refresh token
5. Logout on refresh failure

### Key Endpoints Used
- **Auth**: `/api/auth/*`
- **Branches**: `/api/branches`
- **Fuel Prices**: `/api/fuel-prices/current`
- **Nozzles**: `/api/nozzles`
- **Shifts**: `/api/shifts/*`
- **Meter Readings**: `/api/meter-readings`
- **Sales**: `/api/sales/*`
- **Customers**: `/api/customers`
- **Products**: `/api/products`
- **Bifurcation**: `/api/bifurcation`
- **Reports**: `/api/reports/*`

## State Management

### Zustand Stores

**authStore** (persisted):
- `user`: Current user object
- `token`: JWT access token
- `refreshToken`: JWT refresh token
- `isAuthenticated`: Boolean flag

**appStore** (partially persisted):
- `currentBranch`: Selected branch
- `currentShift`: Active shift instance
- `isOnline`: Network status

**cartStore** (session):
- `items`: Shopping cart items
- `addItem`, `removeItem`, `updateQuantity`
- `clearCart`, `getTotalItems`, `getSubtotal`

## UI Components

### Base Components
- **Button**: Variants (default, primary, secondary, destructive, outline, ghost)
- **Card**: Container with header, title, content sections
- **Input**: Text input with label and error support
- **Select**: Dropdown with label and options

### Custom Components
- **Layout**: Sidebar navigation + header + main content area
- **ProtectedRoute**: Route guard for authenticated access

## Customization

### Themes
Edit `tailwind.config.js` and `src/renderer/index.css` CSS variables:
```css
:root {
  --primary: 221.2 83.2% 53.3%;
  --destructive: 0 100% 50%;
  /* ... */
}
```

### Adding New Screens

1. Create screen component in `src/renderer/screens/NewScreen.tsx`
2. Add route in `src/renderer/App.tsx`:
   ```tsx
   <Route path="/new-screen" element={
     <ProtectedRoute>
       <Layout><NewScreen /></Layout>
     </ProtectedRoute>
   } />
   ```
3. Add navigation item in `src/renderer/components/Layout.tsx`

### Adding API Endpoints

1. Add function in `src/renderer/api/endpoints.ts`:
   ```ts
   export const newApi = {
     getData: () => apiClient.get('/new-endpoint'),
   };
   ```
2. Use in components with React Query:
   ```tsx
   const { data } = useQuery({
     queryKey: ['new-data'],
     queryFn: () => newApi.getData(),
   });
   ```

## Troubleshooting

### Electron won't start
- Check Node version: `node --version` (18+)
- Delete `node_modules` and reinstall
- Check `dist-electron` exists after build

### API connection errors
- Verify backend is running: `curl http://localhost:3000/api/branches`
- Check `.env` file has correct `VITE_API_URL`
- Open DevTools (Ctrl+Shift+I) and check Console/Network tab

### Build errors
- Clear build cache: `rm -rf dist dist-electron`
- Update dependencies: `npm update`
- Check TypeScript errors: `tsc --noEmit`

### Token refresh issues
- Clear persisted state: localStorage → delete `auth-storage`
- Check refresh token validity in backend logs
- Verify `/api/auth/refresh` endpoint is working

## Performance Tips

- **Reduce refetch interval** if network is slow (change from 30s to 60s)
- **Limit pagination** for large datasets (use `limit` param)
- **Enable React Query DevTools** in development:
  ```tsx
  import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
  // Add to App component
  ```
- **Debounce search inputs** for product/customer search

## Security

- **Content Security Policy**: Configured in `index.html`
- **Context Isolation**: Enabled in main process
- **Node Integration**: Disabled in renderer
- **Preload Scripts**: Only expose necessary APIs
- **Token Storage**: Uses Zustand persist (localStorage)
- **HTTPS**: Upgrade HTTP to HTTPS in production

## License

Proprietary - Kuwait Petrol Pump

## Support

For issues or questions, contact the development team.

---

**Version**: 1.0.0
**Last Updated**: March 26, 2026
**Status**: Production Ready
