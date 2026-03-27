# Kuwait Petrol Pump POS - Setup Guide

## ✅ Completed Setup (Tasks #1-3)

- [x] Monorepo structure with pnpm + Turborepo
- [x] Prisma database schema (15 models, all relationships)
- [x] Docker Compose for PostgreSQL + Redis
- [x] TypeScript, ESLint, Prettier configuration
- [x] Seed data (demo users, products, fuel prices)

## 🚀 Quick Start

### 1. Install pnpm (if not installed)

```bash
npm install -g pnpm@8
```

### 2. Install Dependencies

```bash
cd kuwait-petrol-pump
pnpm install
```

### 3. Start Database (Docker)

```bash
cd docker
docker-compose -f docker-compose.dev.yml up -d

# Verify services are running
docker ps
```

### 4. Setup Database

```bash
cd ../packages/database

# Generate Prisma Client
pnpm db:generate

# Run migrations
pnpm db:migrate

# Seed demo data
pnpm db:seed
```

### 5. Verify Database

```bash
# Open Prisma Studio
pnpm db:studio

# Visit http://localhost:5555
# You should see all tables with seed data
```

## 📊 Demo Data Loaded

**Branch**: Main Branch (Kuwait City)

**Dispensing Units**: 4 units, 6 total nozzles
- Unit 1: 2 nozzles (HSD, PMG)
- Unit 2: 1 nozzle (HSD)
- Unit 3: 1 nozzle (PMG)
- Unit 4: 2 nozzles (PMG, PMG)

**Fuel Prices** (from questionnaire):
- PMG (Petrol): 321.17 Rs/Liter
- HSD (Diesel): 335.86 Rs/Liter

**Demo Users**:
| Role | Email | Password |
|------|-------|----------|
| Admin | admin@petrolpump.com | password123 |
| Manager | manager@petrolpump.com | password123 |
| Cashier | cashier@petrolpump.com | password123 |
| Operator | operator@petrolpump.com | password123 |
| Accountant | accountant@petrolpump.com | password123 |

**Sample Customers**: 3 credit customers (XYZ Transport, ABC Logistics, Quick Delivery)

**Sample Products**: 5 non-fuel items (Engine Oil, Oil Filter, Air Filter, etc.)

## 📋 Next Steps

### Task #4: Build Backend API (In Progress)
- Express.js server setup
- JWT authentication
- User CRUD endpoints
- Error handling & logging

### Task #5: Core API Endpoints
- Shifts, Fuel Prices, Sales
- Meter Readings, Bifurcation
- Reports

### Task #6: Desktop POS App
- Electron + React setup
- Authentication UI
- POS screens

## 🐳 Docker Commands

```bash
# Start services
docker-compose -f docker-compose.dev.yml up -d

# Stop services
docker-compose -f docker-compose.dev.yml down

# View logs
docker logs petrol-pump-postgres
docker logs petrol-pump-redis

# Reset database (WARNING: deletes all data)
docker-compose -f docker-compose.dev.yml down -v
docker-compose -f docker-compose.dev.yml up -d
cd ../packages/database && pnpm db:migrate && pnpm db:seed
```

## 🔧 Development Workflow

1. **Make schema changes**: Edit `packages/database/prisma/schema.prisma`
2. **Create migration**: `cd packages/database && pnpm db:migrate`
3. **Generate client**: `pnpm db:generate`
4. **Update seed**: Edit `packages/database/prisma/seed.ts`

## 📚 Useful Commands

```bash
# View all tasks
pnpm turbo run dev --filter=backend  # Run backend only
pnpm turbo run dev --filter=desktop  # Run desktop only

# Database
pnpm db:studio  # Open Prisma Studio
pnpm db:push    # Push schema without migration (dev only)

# Format code
pnpm format

# Lint
pnpm lint
```

## ❓ OCR Samples Needed (Phase 2)

For the Mobile App OCR feature, we need **meter reading photos** from client:
- 2-3 photos per nozzle (6 nozzles total)
- Different lighting conditions (day/night)
- Different angles
- Clean and dirty displays
- **Client confirmed they will send photos**

## 🎯 Phase 1 Goal (Next 30 Days)

Build fully functional Desktop POS + Backend API:
- Fuel sales workflow
- Non-fuel sales POS
- Shift management
- Daily bifurcation
- Reports
- QuickBooks sync
- Offline mode
- Receipt printing
