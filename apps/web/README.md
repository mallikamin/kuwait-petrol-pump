# Kuwait Petrol Pump - Web Admin Dashboard

A comprehensive React-based admin dashboard for managing petrol pump operations in Kuwait.

## Features

### Core Functionality
- **Dashboard**: Real-time overview of sales, active shifts, and key metrics
- **Branches**: Manage multiple petrol pump locations
- **Fuel Prices**: Track and update fuel pricing
- **Shifts**: Monitor and manage employee shifts
- **Meter Readings**: OCR-enabled meter reading verification
- **Sales**: Complete sales transaction management
- **Customers**: Customer account and credit management
- **Products**: Inventory and product management
- **Bifurcation**: Cash reconciliation and variance reporting
- **Reports**: Comprehensive business reporting
- **Users**: User management and role-based access control

### Technical Features
- Real-time data updates with React Query
- Role-based UI rendering
- Dark mode support
- Responsive design (desktop-first)
- Advanced data tables with sorting, filtering, and pagination
- Form validation
- Toast notifications
- Loading skeletons
- Error boundaries
- Export functionality (CSV, PDF, Excel)
- Search with debouncing

## Tech Stack

- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite
- **Styling**: TailwindCSS + shadcn/ui
- **Routing**: React Router v6
- **State Management**: Zustand
- **Data Fetching**: React Query (TanStack Query)
- **Charts**: Recharts
- **Tables**: TanStack Table
- **HTTP Client**: Axios

## Getting Started

### Prerequisites
- Node.js 18+
- pnpm (recommended) or npm

### Installation

```bash
# Install dependencies
pnpm install

# Create environment file
cp .env.example .env

# Update .env with your API URL
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000
```

### Development

```bash
# Start development server
pnpm dev

# The app will be available at http://localhost:3000
```

### Build

```bash
# Build for production
pnpm build

# Preview production build
pnpm preview
```

## Project Structure

```
src/
├── api/              # API client and endpoints
│   ├── client.ts     # Axios instance with interceptors
│   ├── auth.ts       # Authentication endpoints
│   ├── dashboard.ts  # Dashboard data endpoints
│   └── ...           # Other API modules
├── components/
│   ├── ui/           # shadcn/ui components
│   ├── layout/       # Layout components (Sidebar, TopBar, etc.)
│   ├── charts/       # Chart components
│   └── tables/       # Table components
├── pages/            # Page components
├── store/            # Zustand stores
│   ├── auth.ts       # Authentication state
│   └── theme.ts      # Theme state
├── hooks/            # Custom React hooks
├── types/            # TypeScript type definitions
├── utils/            # Utility functions
│   ├── cn.ts         # Class name utility
│   └── format.ts     # Formatting utilities
├── App.tsx           # Main app component with routing
├── main.tsx          # App entry point
└── index.css         # Global styles
```

## Default Login Credentials

For testing purposes:
- **Admin**: `admin` / `admin123`
- **Manager**: `manager` / `manager123`
- **Cashier**: `cashier` / `cashier123`

## Role-Based Access

- **Admin**: Full access to all features
- **Manager**: Access to all operational features, limited admin functions
- **Cashier**: Access to sales and shift management only
- **Auditor**: Read-only access to reports and bifurcations

## API Integration

The app expects a REST API at the `VITE_API_URL` endpoint. All API requests include:
- JWT authentication via Bearer token
- Automatic token refresh on 401 responses
- Error handling with toast notifications

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_URL` | Backend API URL | `http://localhost:8000` |
| `VITE_WS_URL` | WebSocket URL | `ws://localhost:8000` |

## Development Notes

- The app uses React Query for data fetching with automatic refetching intervals
- Zustand provides lightweight state management with persistence
- All forms use controlled components with validation
- Dark mode preference is persisted in localStorage
- Authentication state is persisted across sessions

## Contributing

1. Follow the existing code structure and naming conventions
2. Use TypeScript strictly (no `any` types)
3. Add proper error handling
4. Include loading and empty states
5. Test with different user roles
6. Ensure responsive design works on all screen sizes

## License

Proprietary - Sitara Infotech
