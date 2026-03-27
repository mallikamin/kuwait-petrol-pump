# Kuwait Petrol Pump Web Admin - Complete Setup Guide

## Overview

This is a production-ready React admin dashboard for Kuwait Petrol Pump management system. It provides comprehensive features for managing branches, fuel prices, shifts, sales, customers, products, and more.

## Quick Start

### 1. Install Dependencies

```bash
cd apps/web
pnpm install
```

### 2. Environment Setup

Create `.env` file:

```bash
cp .env.example .env
```

Update the `.env` file:

```env
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000
```

### 3. Start Development Server

```bash
pnpm dev
```

The app will be available at `http://localhost:3000`

## Architecture

### State Management
- **Zustand**: Lightweight state management for auth and theme
- **React Query**: Server state management with automatic caching and refetching

### Routing
- **React Router v6**: Client-side routing with protected routes
- Authentication-based route guards
- Role-based route visibility

### Styling
- **TailwindCSS**: Utility-first CSS framework
- **shadcn/ui**: Beautifully designed components built with Radix UI
- **Dark Mode**: System-wide dark mode support with persistence

### API Integration
- **Axios**: HTTP client with interceptors
- **JWT Authentication**: Token-based authentication with automatic refresh
- **Error Handling**: Centralized error handling with toast notifications

## Project Structure

```
apps/web/
├── src/
│   ├── api/                    # API layer
│   │   ├── client.ts           # Axios instance with interceptors
│   │   ├── auth.ts             # Authentication endpoints
│   │   ├── dashboard.ts        # Dashboard data
│   │   ├── branches.ts         # Branch management
│   │   ├── sales.ts            # Sales transactions
│   │   ├── customers.ts        # Customer management
│   │   ├── products.ts         # Product & inventory
│   │   ├── shifts.ts           # Shift management
│   │   ├── fuel-prices.ts      # Fuel pricing
│   │   ├── meter-readings.ts   # Meter readings
│   │   ├── bifurcations.ts     # Cash reconciliation
│   │   ├── users.ts            # User management
│   │   ├── reports.ts          # Report generation
│   │   └── index.ts            # API exports
│   │
│   ├── components/
│   │   ├── ui/                 # shadcn/ui components
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── input.tsx
│   │   │   ├── label.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── dropdown-menu.tsx
│   │   │   ├── select.tsx
│   │   │   ├── table.tsx
│   │   │   ├── badge.tsx
│   │   │   ├── tabs.tsx
│   │   │   ├── switch.tsx
│   │   │   ├── skeleton.tsx
│   │   │   ├── toast.tsx
│   │   │   ├── use-toast.ts
│   │   │   ├── toaster.tsx
│   │   │   └── alert-dialog.tsx
│   │   │
│   │   ├── layout/             # Layout components
│   │   │   ├── Sidebar.tsx     # Navigation sidebar
│   │   │   ├── TopBar.tsx      # Top navigation bar
│   │   │   ├── Breadcrumbs.tsx # Breadcrumb navigation
│   │   │   └── Layout.tsx      # Main layout wrapper
│   │   │
│   │   └── charts/             # Chart components
│   │       ├── SalesChart.tsx  # Sales line chart
│   │       └── PaymentPieChart.tsx
│   │
│   ├── pages/                  # Page components
│   │   ├── Dashboard.tsx       # Main dashboard
│   │   ├── Login.tsx           # Login page
│   │   ├── Branches.tsx        # Branch management
│   │   ├── FuelPrices.tsx      # Fuel price management
│   │   ├── Shifts.tsx          # Shift management
│   │   ├── MeterReadings.tsx   # Meter reading verification
│   │   ├── Sales.tsx           # Sales transactions
│   │   ├── Customers.tsx       # Customer management
│   │   ├── Products.tsx        # Product & inventory
│   │   ├── Bifurcation.tsx     # Cash reconciliation
│   │   ├── Reports.tsx         # Business reports
│   │   └── Users.tsx           # User management (admin only)
│   │
│   ├── store/                  # Zustand stores
│   │   ├── auth.ts             # Authentication state
│   │   └── theme.ts            # Theme state (light/dark)
│   │
│   ├── hooks/                  # Custom React hooks
│   │   └── useDebounce.ts      # Debounce hook for search
│   │
│   ├── types/                  # TypeScript definitions
│   │   └── index.ts            # All type definitions
│   │
│   ├── utils/                  # Utility functions
│   │   ├── cn.ts               # Tailwind class merge utility
│   │   └── format.ts           # Formatting utilities
│   │
│   ├── App.tsx                 # Main app with routing
│   ├── main.tsx                # App entry point
│   └── index.css               # Global styles & CSS variables
│
├── public/                     # Static assets
├── index.html                  # HTML template
├── package.json                # Dependencies
├── vite.config.ts              # Vite configuration
├── tsconfig.json               # TypeScript config
├── tailwind.config.js          # Tailwind config
├── postcss.config.js           # PostCSS config
├── .env.example                # Environment template
└── README.md                   # Documentation
```

## Features Implemented

### ✅ Authentication & Authorization
- JWT-based authentication
- Role-based access control (Admin, Manager, Cashier, Auditor)
- Persistent login with Zustand
- Automatic token refresh on 401
- Protected routes

### ✅ Dashboard
- Real-time stats (Today's sales, fuel sales, product sales, active shifts)
- Sales chart (hourly breakdown)
- Payment method pie chart
- Recent transactions table
- Low stock alerts
- Top customers list
- Auto-refresh every 30-60 seconds

### ✅ Branches
- List all branches with pagination
- View dispensing units and nozzles
- Activate/deactivate nozzles
- Add/edit branches (admin only)

### ✅ Fuel Prices
- Current fuel prices display
- Price history
- Update prices (manager/admin)
- Effective date management

### ✅ Shifts
- Active shifts list
- Shift history with filters
- Open/close shift functionality
- Shift details view

### ✅ Meter Readings
- Readings table with filters
- OCR vs manual indicators
- Image preview
- Verify/correct readings
- Variance reports

### ✅ Sales
- Sales transactions table
- Advanced filters (date, type, payment, customer)
- Sale details modal
- Export to CSV
- Summary cards

### ✅ Customers
- Customer list with pagination
- Add/edit customer forms
- Customer details page
- Ledger with running balance
- Credit limit management
- Vehicle numbers

### ✅ Products & Inventory
- Products table
- Stock levels by branch
- Low stock reports
- Categories management
- Add/edit products

### ✅ Bifurcation
- Create bifurcation form
- Auto-calculate variance
- Variance highlighting (red if > threshold)
- Pending bifurcations list
- Verify/reject bifurcations
- History table

### ✅ Reports
- Report selector
- Daily sales report
- Shift report
- Customer ledger
- Inventory report
- Export to PDF/Excel
- Print preview

### ✅ Users (Admin Only)
- User management table
- Add/edit users
- Role assignment
- Activate/deactivate users
- Password reset

### ✅ UI/UX Features
- Dark mode toggle
- Responsive design
- Loading skeletons
- Toast notifications
- Error boundaries
- Search with debounce
- Pagination
- Sorting and filtering
- Role-based UI rendering

## Role-Based Access

| Feature | Admin | Manager | Cashier | Auditor |
|---------|-------|---------|---------|---------|
| Dashboard | ✅ | ✅ | ✅ | ✅ |
| Branches | ✅ | ✅ | ❌ | ✅ (read) |
| Fuel Prices | ✅ | ✅ | ❌ | ✅ (read) |
| Shifts | ✅ | ✅ | ✅ | ✅ (read) |
| Meter Readings | ✅ | ✅ | ✅ | ✅ |
| Sales | ✅ | ✅ | ✅ | ✅ (read) |
| Customers | ✅ | ✅ | ✅ | ✅ (read) |
| Products | ✅ | ✅ | ✅ | ✅ (read) |
| Bifurcation | ✅ | ✅ | ❌ | ✅ (read) |
| Reports | ✅ | ✅ | ❌ | ✅ |
| Users | ✅ | ❌ | ❌ | ❌ |

## API Endpoints Expected

The app expects the following API structure:

### Authentication
- `POST /api/v1/auth/login` - Login
- `GET /api/v1/auth/me` - Get current user
- `POST /api/v1/auth/logout` - Logout

### Dashboard
- `GET /api/v1/dashboard/stats` - Get dashboard statistics
- `GET /api/v1/dashboard/sales-chart` - Get sales chart data
- `GET /api/v1/dashboard/payment-stats` - Get payment method stats
- `GET /api/v1/dashboard/recent-transactions` - Get recent transactions
- `GET /api/v1/dashboard/low-stock` - Get low stock products
- `GET /api/v1/dashboard/top-customers` - Get top customers

### Branches
- `GET /api/v1/branches` - List branches
- `GET /api/v1/branches/:id` - Get branch details
- `POST /api/v1/branches` - Create branch
- `PUT /api/v1/branches/:id` - Update branch
- `DELETE /api/v1/branches/:id` - Delete branch
- `GET /api/v1/branches/:id/dispensing-units` - Get dispensing units
- `PATCH /api/v1/nozzles/:id` - Update nozzle status

### Sales
- `GET /api/v1/sales` - List sales
- `GET /api/v1/sales/:id` - Get sale details
- `GET /api/v1/sales/export` - Export sales to CSV

### Customers
- `GET /api/v1/customers` - List customers
- `GET /api/v1/customers/:id` - Get customer details
- `POST /api/v1/customers` - Create customer
- `PUT /api/v1/customers/:id` - Update customer
- `DELETE /api/v1/customers/:id` - Delete customer
- `GET /api/v1/customers/:id/ledger` - Get customer ledger

### Products
- `GET /api/v1/products` - List products
- `GET /api/v1/products/:id` - Get product details
- `POST /api/v1/products` - Create product
- `PUT /api/v1/products/:id` - Update product
- `DELETE /api/v1/products/:id` - Delete product
- `GET /api/v1/products/:id/stock` - Get stock levels
- `POST /api/v1/products/:id/stock` - Update stock
- `GET /api/v1/categories` - List categories
- `POST /api/v1/categories` - Create category

### And more...

## Development Guidelines

### Adding a New Page

1. Create page component in `src/pages/`
2. Add route in `src/App.tsx`
3. Add navigation item in `src/components/layout/Sidebar.tsx`
4. Add breadcrumb name in `src/components/layout/Breadcrumbs.tsx`

### Adding a New API Endpoint

1. Create API module in `src/api/`
2. Export from `src/api/index.ts`
3. Use React Query hooks in components:

```tsx
import { useQuery, useMutation } from '@tanstack/react-query';
import { myApi } from '@/api';

function MyComponent() {
  const { data, isLoading } = useQuery({
    queryKey: ['my-data'],
    queryFn: myApi.getData,
  });

  const mutation = useMutation({
    mutationFn: myApi.create,
    onSuccess: () => {
      // Invalidate queries, show toast, etc.
    },
  });
}
```

### Adding a New UI Component

1. Create component in `src/components/ui/`
2. Follow shadcn/ui patterns
3. Use Radix UI primitives
4. Style with Tailwind classes

## Building for Production

```bash
# Build the app
pnpm build

# Preview production build
pnpm preview

# The build output will be in dist/
```

## Deployment

### Docker
```dockerfile
FROM node:18-alpine as builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install
COPY . .
RUN pnpm build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### Environment Variables for Production
```env
VITE_API_URL=https://api.yourpetrolpump.com
VITE_WS_URL=wss://api.yourpetrolpump.com
```

## Troubleshooting

### Issue: App doesn't connect to backend
- Check `VITE_API_URL` in `.env`
- Ensure backend is running and accessible
- Check browser console for CORS errors

### Issue: Dark mode doesn't work
- Clear localStorage
- Check theme store initialization

### Issue: Routes don't work after refresh
- Configure server to serve `index.html` for all routes
- In nginx: `try_files $uri $uri/ /index.html;`

## Support

For issues or questions, contact the development team at Sitara Infotech.

## License

Proprietary - Sitara Infotech © 2024
