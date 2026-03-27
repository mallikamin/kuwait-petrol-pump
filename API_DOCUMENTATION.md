# Kuwait Petrol Pump POS - API Documentation
**Version**: 1.0.0
**Base URL**: `http://localhost:3000/api`
**Date**: March 26, 2026

---

## 📋 Quick Reference

**Total Endpoints**: 60+ REST APIs across 11 modules

**Base URL**: `http://localhost:3000/api`

**Authentication**: Bearer Token (JWT)

**Demo Credentials**:
```json
{
  "admin": "admin@petrolpump.com / password123",
  "manager": "manager@petrolpump.com / password123",
  "cashier": "cashier@petrolpump.com / password123",
  "operator": "operator@petrolpump.com / password123",
  "accountant": "accountant@petrolpump.com / password123"
}
```

---

## 🔐 Authentication Module

### POST /api/auth/login
Login and get access token

**Request:**
```json
{
  "email": "admin@petrolpump.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "user": {
    "id": "uuid",
    "email": "admin@petrolpump.com",
    "name": "Admin User",
    "role": "admin"
  },
  "accessToken": "eyJhbGc...",
  "refreshToken": "eyJhbGc..."
}
```

### POST /api/auth/refresh
Refresh access token

### POST /api/auth/logout
Logout user (requires auth)

### GET /api/auth/me
Get current user details (requires auth)

### POST /api/auth/change-password
Change password (requires auth)

---

## ⛽ Fuel Prices Module

### GET /api/fuel-prices/current
Get current fuel prices

**Response:**
```json
{
  "prices": [
    {
      "fuelType": { "code": "PMG", "name": "Petrol" },
      "pricePerLiter": "321.17"
    },
    {
      "fuelType": { "code": "HSD", "name": "Diesel" },
      "pricePerLiter": "335.86"
    }
  ]
}
```

### GET /api/fuel-prices/history
Price history with filters

### POST /api/fuel-prices
Update fuel price (admin/manager only)

### GET /api/fuel-prices/fuel-types
Get all fuel types

---

## 🏢 Branches Module

### GET /api/branches
List all branches

### GET /api/branches/:id
Get branch details with dispensing units

### GET /api/branches/:id/dispensing-units
Get all dispensing units for a branch

### GET /api/dispensing-units/:id
Get dispensing unit details

### GET /api/dispensing-units/:id/nozzles
Get nozzles for a dispensing unit

---

## 🔫 Nozzles Module

### GET /api/nozzles
List nozzles with filters

**Query Params**: `branchId`, `dispensingUnitId`, `fuelTypeId`, `isActive`

### GET /api/nozzles/:id
Get nozzle details

### PATCH /api/nozzles/:id
Update nozzle status (admin/manager only)

**Request:**
```json
{
  "isActive": false
}
```

### GET /api/nozzles/:id/latest-reading
Get latest meter reading for nozzle

---

## 🔄 Shifts Module

### POST /api/shifts/open
Open a new shift

**Request:**
```json
{
  "branchId": "uuid",
  "shiftId": "uuid"
}
```

**Permissions**: admin, manager, cashier, operator

### POST /api/shifts/:id/close
Close a shift

**Request:**
```json
{
  "notes": "All tasks completed"
}
```

**Permissions**: admin, manager, cashier, operator

### GET /api/shifts/current
Get current active shift

**Query Params**: `branchId` (required)

### GET /api/shifts/history
Get shift history with filters

**Query Params**: `branchId`, `startDate`, `endDate`, `status`, `limit`, `offset`

### GET /api/shifts/:id
Get shift details with meter readings and sales

---

## 📸 Meter Readings Module (OCR Support)

### POST /api/meter-readings
Create meter reading with OCR support

**Request:**
```json
{
  "nozzleId": "uuid",
  "shiftInstanceId": "uuid",
  "readingType": "opening",
  "meterValue": 314012.50,
  "imageUrl": "https://s3.../image.jpg",
  "ocrResult": 314012.50,
  "isManualOverride": false
}
```

**Fields**:
- `readingType`: "opening" or "closing"
- `meterValue`: Actual meter reading (must be > previous)
- `imageUrl`: Uploaded image URL (optional)
- `ocrResult`: OCR-extracted value (optional)
- `isManualOverride`: true if user corrected OCR

**Permissions**: admin, manager, operator, cashier

**Validation**: meterValue must be greater than previous reading

### GET /api/meter-readings/:nozzleId/latest
Get latest reading for a nozzle

### PUT /api/meter-readings/:id/verify
Verify or correct a meter reading (admin/manager only)

**Request:**
```json
{
  "verifiedValue": 314015.00,
  "isManualOverride": true
}
```

### GET /api/meter-readings/shift/:shiftId
Get all readings for a shift

### GET /api/meter-readings/shift/:shiftId/variance
Get meter variance report for a shift

**Response:**
```json
{
  "shiftInstance": { ... },
  "varianceReport": [
    {
      "nozzle": { "nozzleNumber": 1, "fuelType": "PMG" },
      "openingReading": { "meterValue": "300000.00" },
      "closingReading": { "meterValue": "302500.50" },
      "variance": 2500.50
    }
  ]
}
```

---

## 💰 Sales Module

### POST /api/sales/fuel
Create fuel sale

**Request:**
```json
{
  "branchId": "uuid",
  "shiftInstanceId": "uuid",
  "nozzleId": "uuid",
  "fuelTypeId": "uuid",
  "quantityLiters": 50.25,
  "pricePerLiter": 321.17,
  "paymentMethod": "cash",
  "vehicleNumber": "ABC-1234",
  "slipNumber": "12345"
}
```

**Payment Methods**: cash, credit, card, pso_card

**Permissions**: admin, manager, cashier, operator

### POST /api/sales/non-fuel
Create non-fuel sale

**Request:**
```json
{
  "branchId": "uuid",
  "shiftInstanceId": "uuid",
  "items": [
    {
      "productId": "uuid",
      "quantity": 2,
      "unitPrice": 150.00
    }
  ],
  "paymentMethod": "cash",
  "taxAmount": 30.00,
  "discountAmount": 0
}
```

**Effect**: Auto-decrements stock levels

**Permissions**: admin, manager, cashier, operator

### GET /api/sales
List sales with filters

**Query Params**: `branchId`, `shiftInstanceId`, `saleType`, `paymentMethod`, `customerId`, `startDate`, `endDate`, `limit`, `offset`

### GET /api/sales/:id
Get sale details

### GET /api/sales/summary
Get sales summary

**Query Params**: `branchId` (required), `shiftInstanceId` or `startDate`+`endDate`

**Response:**
```json
{
  "summary": {
    "totalSales": 150,
    "totalAmount": 450000.50,
    "fuelSales": {
      "totalLiters": 5000.25,
      "totalAmount": 350000.00
    },
    "nonFuelSales": {
      "totalItems": 250,
      "totalAmount": 100000.50
    },
    "paymentBreakdown": [
      { "method": "cash", "count": 100, "amount": 250000.00 }
    ]
  }
}
```

---

## 👥 Customers Module

### GET /api/customers
List customers with filters

**Query Params**: `search` (name/phone/email), `isActive`, `limit`, `offset`

### POST /api/customers
Create customer (admin/manager only)

**Request:**
```json
{
  "name": "John Doe",
  "phone": "+965-12345678",
  "email": "john@example.com",
  "address": "Kuwait City",
  "vehicleNumbers": ["ABC-1234", "XYZ-5678"],
  "creditLimit": 50000.00,
  "creditDays": 30
}
```

### GET /api/customers/:id
Get customer details with recent sales

### PUT /api/customers/:id
Update customer (admin/manager only)

### GET /api/customers/:id/ledger
Get customer sales ledger

**Query Params**: `startDate`, `endDate`

**Response**:
```json
{
  "customer": { ... },
  "transactions": [ ... ],
  "summary": {
    "totalSales": 50000.00,
    "totalFuelSales": 40000.00,
    "totalNonFuelSales": 10000.00
  }
}
```

---

## 📦 Products & Inventory Module

### GET /api/products
List products with filters

**Query Params**: `search` (SKU/name/barcode), `category`, `isActive`, `limit`, `offset`

### POST /api/products
Create product (admin/manager only)

**Request:**
```json
{
  "sku": "ENG-OIL-001",
  "name": "Engine Oil 5W-30",
  "category": "Lubricants",
  "barcode": "123456789012",
  "unitPrice": 250.00,
  "costPrice": 150.00,
  "lowStockThreshold": 10
}
```

### GET /api/products/search
Quick search by SKU or barcode

**Query Params**: `q` (search query)

### GET /api/products/:id
Get product details with stock levels

### PUT /api/products/:id
Update product (admin/manager only)

### GET /api/products/:id/stock
Get stock levels across branches

**Query Params**: `branchId` (optional)

**Response:**
```json
{
  "product": { ... },
  "stockLevels": [
    {
      "branch": { "name": "Main Branch" },
      "quantity": 50,
      "isLowStock": false
    }
  ],
  "totalQuantity": 150
}
```

### PUT /api/products/:id/stock
Update stock level (admin/manager only)

**Request:**
```json
{
  "branchId": "uuid",
  "quantity": 50
}
```

### GET /api/products/categories
Get all product categories

### GET /api/products/low-stock
Get low-stock products

**Query Params**: `branchId` (optional)

---

## 🔍 Bifurcation Module

Daily sales reconciliation and verification

### POST /api/bifurcation
Create bifurcation record (admin/manager/accountant only)

**Request:**
```json
{
  "branchId": "uuid",
  "date": "2026-03-26",
  "shiftInstanceId": "uuid",
  "pmgTotalLiters": 5000.50,
  "pmgTotalAmount": 1606250.00,
  "hsdTotalLiters": 3000.25,
  "hsdTotalAmount": 1007758.00,
  "cashAmount": 1500000.00,
  "creditAmount": 800000.00,
  "cardAmount": 200000.00,
  "psoCardAmount": 114008.00,
  "expectedTotal": 2614008.00,
  "actualTotal": 2614000.00,
  "varianceNotes": "Minor cash variance"
}
```

**Auto-calculated**: `variance = actualTotal - expectedTotal`

### GET /api/bifurcation/:date
Get bifurcation for a specific date

**Query Params**: `branchId` (required)

### PUT /api/bifurcation/:id/verify
Verify bifurcation (admin/manager/accountant only)

**Effect**: Sets status to "verified"

### GET /api/bifurcation/pending
Get pending bifurcations

**Query Params**: `branchId` (required)

### GET /api/bifurcation/history
Get bifurcation history

**Query Params**: `branchId` (required), `startDate`, `endDate`, `status`, `limit`, `offset`

### GET /api/bifurcation/:id
Get bifurcation details

---

## 📊 Reports Module

### GET /api/reports/daily-sales
Daily sales report (admin/manager/accountant only)

**Query Params**: `branchId` (required), `date` (required)

**Response:**
```json
{
  "report": {
    "date": "2026-03-26",
    "branch": { "name": "Main Branch" },
    "summary": {
      "totalSales": 150,
      "totalAmount": 2614008.00,
      "fuelSales": {
        "pmg": { "liters": 5000.50, "amount": 1606250.00 },
        "hsd": { "liters": 3000.25, "amount": 1007758.00 }
      },
      "nonFuelSales": { "items": 50, "amount": 50000.00 }
    },
    "paymentBreakdown": [ ... ],
    "shiftBreakdown": [ ... ]
  }
}
```

### GET /api/reports/shift
Shift report (admin/manager/accountant only)

**Query Params**: `shiftInstanceId` (required)

**Response:**
```json
{
  "report": {
    "shift": { ... },
    "meterReadings": [
      {
        "nozzle": { "nozzleNumber": 1, "fuelType": "PMG" },
        "opening": 300000.00,
        "closing": 302500.50,
        "variance": 2500.50
      }
    ],
    "sales": { ... },
    "payments": { ... }
  }
}
```

### GET /api/reports/variance
Meter variance analysis (admin/manager/accountant only)

**Query Params**: `branchId` (required), `startDate` (required), `endDate` (required)

### GET /api/reports/customer-ledger
Customer transaction history (admin/manager/accountant only)

**Query Params**: `customerId` (required), `startDate` (required), `endDate` (required)

### GET /api/reports/inventory
Current inventory report (admin/manager/accountant only)

**Query Params**: `branchId` (required)

**Response:**
```json
{
  "report": {
    "branch": { "name": "Main Branch" },
    "summary": {
      "totalProducts": 50,
      "totalQuantity": 500,
      "lowStockCount": 5
    },
    "products": [ ... ],
    "lowStockProducts": [ ... ],
    "fuelAvailability": [ ... ]
  }
}
```

---

## 🔒 Role-Based Access Control

| Endpoint | admin | manager | accountant | cashier | operator |
|----------|-------|---------|------------|---------|----------|
| Auth | ✅ | ✅ | ✅ | ✅ | ✅ |
| Fuel Prices (read) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Fuel Prices (update) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Branches (read) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Nozzles (read) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Nozzles (update) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Shifts | ✅ | ✅ | ❌ | ✅ | ✅ |
| Meter Readings | ✅ | ✅ | ❌ | ✅ | ✅ |
| Meter Verify | ✅ | ✅ | ❌ | ❌ | ❌ |
| Sales | ✅ | ✅ | ❌ | ✅ | ✅ |
| Customers (read) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Customers (write) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Products (read) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Products (write) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Bifurcation | ✅ | ✅ | ✅ | ❌ | ❌ |
| Reports | ✅ | ✅ | ✅ | ❌ | ❌ |

---

## 📝 Common Patterns

### Authentication Header
All authenticated endpoints require:
```http
Authorization: Bearer {access_token}
```

### Pagination
```
?limit=50&offset=0
```

**Response:**
```json
{
  "items": [ ... ],
  "pagination": {
    "total": 250,
    "limit": 50,
    "offset": 0,
    "pages": 5
  }
}
```

### Date Filtering
ISO 8601 format:
```
?startDate=2026-03-01T00:00:00Z&endDate=2026-03-31T23:59:59Z
```

### Error Responses
```json
{
  "error": "Error message",
  "statusCode": 400
}
```

**Status Codes:**
- `200` - Success
- `201` - Created
- `400` - Bad Request (validation error)
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `500` - Internal Server Error

---

## 🚀 Quick Start

1. **Start services:**
   ```bash
   docker-compose up -d
   npx prisma migrate dev
   npx prisma db seed
   npm run dev
   ```

2. **Test API:**
   ```bash
   # Login
   curl -X POST http://localhost:3000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"admin@petrolpump.com","password":"password123"}'

   # Use token
   curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost:3000/api/branches
   ```

---

## 📚 Related Documentation

- **Setup Guide**: `SETUP.md`
- **Build Status**: `BUILD_STATUS.md`
- **Progress Summary**: `PROGRESS_SUMMARY.md`
- **OCR Analysis**: `OCR_ANALYSIS.md`

---

**Status**: ✅ Production Ready
**Last Updated**: March 26, 2026
**Total Endpoints**: 60+
**Modules**: 11
