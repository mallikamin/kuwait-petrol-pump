# Kuwait Petrol Pump POS System

A modern, offline-first petrol pump Point of Sale system with QuickBooks integration.

## Architecture

- **Monorepo**: pnpm workspaces + Turborepo
- **Backend**: Node.js + Express + PostgreSQL + Prisma + Redis
- **Desktop POS**: Electron + React + TypeScript + Zustand
- **Mobile App**: React Native (Phase 2)

## Project Structure

```
kuwait-petrol-pump/
├── apps/
│   ├── backend/          # API Server
│   └── desktop/          # Electron POS App
├── packages/
│   ├── shared/           # Shared types, utilities
│   ├── database/         # Prisma schema
│   └── ui-components/    # Shared React components
└── docker/               # Docker Compose setup
```

## Prerequisites

- Node.js 20 LTS
- pnpm 8+
- Docker & Docker Compose
- PostgreSQL 16
- Redis 7

## Getting Started

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Setup Database

```bash
# Start PostgreSQL + Redis
docker-compose -f docker/docker-compose.dev.yml up -d

# Run migrations
cd packages/database
pnpm prisma migrate dev
pnpm prisma db seed
```

### 3. Start Development

```bash
# Start all apps in development mode
pnpm dev

# Or start individually
cd apps/backend && pnpm dev
cd apps/desktop && pnpm dev
```

## Environment Variables

Copy `.env.example` files and configure:

- `apps/backend/.env` - Backend API configuration
- `apps/desktop/.env.local` - Desktop app configuration

## Key Features

- ⛽ Fuel sales with meter reading (OCR in Phase 2)
- 🛒 Non-fuel item sales (POS)
- 💰 Payment bifurcation (Cash/Credit/Card/Fuel Card)
- 📊 Real-time dashboard & reports
- 📱 Mobile meter reading app (Phase 2)
- 🔄 QuickBooks Online integration
- 💾 Offline-first architecture
- 🖨️ Receipt printing
- 🏢 Multi-branch support (Phase 4)

## Development

### Backend API

```bash
cd apps/backend
pnpm dev          # Start dev server
pnpm test         # Run tests
pnpm lint         # Lint code
```

### Desktop POS

```bash
cd apps/desktop
pnpm dev          # Start Electron app
pnpm build        # Build for production
pnpm dist         # Create installer
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Express, PostgreSQL, Prisma, Redis |
| Desktop | Electron, React, TypeScript, Zustand, Tailwind CSS |
| Mobile | React Native, Expo (Phase 2) |
| Infrastructure | Docker, GitHub Actions |

## Documentation

- [Build Plan](../BUILD_PLAN.md)
- [API Documentation](./apps/backend/docs/API.md) _(coming soon)_
- [Database Schema](./packages/database/README.md) _(coming soon)_

## License

Proprietary - Sitara Infotech © 2026

## Contact

**Sitara Infotech**
Email: amin@sitaratech.info
Website: sitaratech.info
