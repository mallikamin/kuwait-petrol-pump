"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var client_1 = require("@prisma/client");
var prisma = new client_1.PrismaClient();
// Extracted from inventory-list.xlsx rows 2-102
var INVENTORY_DATA = [
    // Fuel items
    { name: 'HSD', category: 'Fuel', costPrice: 278.91, unitPrice: 285.97 },
    { name: 'PMG', category: 'Fuel', costPrice: 259.92, unitPrice: 266.98 },
    // Non-fuel items
    { name: '2 Stroke Oil 1 Ltr', category: 'Non-Fuel', costPrice: 776.80, unitPrice: 850.00 },
    { name: 'AC TOYOTA GLI', category: 'Non-Fuel', costPrice: 350.00, unitPrice: 700.00 },
    { name: 'AIR FILTER GUARD 1050', category: 'Non-Fuel', costPrice: 420.00, unitPrice: 600.00 },
    { name: 'AIR FILTER GUARD 2022', category: 'Non-Fuel', costPrice: 440.84, unitPrice: 750.00 },
    { name: 'AIR FILTER GUARD 2042', category: 'Non-Fuel', costPrice: 385.00, unitPrice: 700.00 },
    { name: 'AIR FILTER GUARD 449', category: 'Non-Fuel', costPrice: 315.78, unitPrice: 460.00 },
    { name: 'ALTO AC FILTER', category: 'Non-Fuel', costPrice: 200.00, unitPrice: 450.00 },
    { name: 'BLAZE 4T 1 LTR', category: 'Non-Fuel', costPrice: 892.00, unitPrice: 905.00 },
    { name: 'BLAZE 4T 700ml', category: 'Non-Fuel', costPrice: 656.79, unitPrice: 670.00 },
    { name: 'BLAZE XTREME 4T 01 LITTER', category: 'Non-Fuel', costPrice: 1052.00, unitPrice: 1100.00 },
    { name: 'BRAKE OIL GUARD Large', category: 'Non-Fuel', costPrice: 282.00, unitPrice: 290.00 },
    { name: 'CARIENT FULLY SYN 5W30 4 LTR', category: 'Non-Fuel', costPrice: 7260.08, unitPrice: 8000.00 },
    { name: 'CARIENT PLUS 20W-50 1LTR', category: 'Non-Fuel', costPrice: 1118.00, unitPrice: 1140.00 },
    { name: 'CARIENT PLUS 20W-50 3 LTR', category: 'Non-Fuel', costPrice: 3264.02, unitPrice: 3330.00 },
    { name: 'CARIENT PLUS 20W-50 4 LTR', category: 'Non-Fuel', costPrice: 4352.03, unitPrice: 4440.00 },
    { name: 'CARIENT PSO 5W 30 4 LTR', category: 'Non-Fuel', costPrice: 7633.00, unitPrice: 8600.00 },
    { name: 'Carient S PRO 5-W 30 4L', category: 'Non-Fuel', costPrice: 7632.00, unitPrice: 8600.00 },
    { name: 'CARIENT ULTRA 1 LTR', category: 'Non-Fuel', costPrice: 1401.00, unitPrice: 1450.00 },
    { name: 'CARIENT ULTRA 3 LTR', category: 'Non-Fuel', costPrice: 4113.00, unitPrice: 4250.00 },
    { name: 'CARIENT ULTRA SAE 4 LTR', category: 'Non-Fuel', costPrice: 5484.00, unitPrice: 5660.00 },
    { name: 'COASTER AIR FILTER', category: 'Non-Fuel', costPrice: 1087.50, unitPrice: 1800.00 },
    { name: 'COROLLA  AC FILTER', category: 'Non-Fuel', costPrice: 250.00, unitPrice: 300.00 },
    { name: 'CULTUS AC FILTER', category: 'Non-Fuel', costPrice: 180.00, unitPrice: 350.00 },
    { name: 'DEO 3000 SAE-50 10 LTR', category: 'Non-Fuel', costPrice: 8112.00, unitPrice: 9050.00 },
    { name: 'DEO 3000 SAE-50 4 LTR', category: 'Non-Fuel', costPrice: 3364.80, unitPrice: 3620.00 },
    { name: 'DEO 6000 20W-50 10 LTR', category: 'Non-Fuel', costPrice: 9724.08, unitPrice: 10500.00 },
    { name: 'DEO 6000 20W-50 4 LTR', category: 'Non-Fuel', costPrice: 4112.01, unitPrice: 4200.00 },
    { name: 'DEO 8000  SAE 15W-40 10 LTR', category: 'Non-Fuel', costPrice: 11692.00, unitPrice: 12000.00 },
    { name: 'DEO 8000  SAE 15W-40 4 LTR', category: 'Non-Fuel', costPrice: 4676.80, unitPrice: 4800.00 },
    { name: 'DEO 8000 1 LTR', category: 'Non-Fuel', costPrice: 1200.00, unitPrice: 1250.00 },
    { name: 'DEO MAX CK 4 LTR', category: 'Non-Fuel', costPrice: 5708.78, unitPrice: 6800.00 },
    { name: 'DG CARD', category: 'Non-Fuel', costPrice: 200.00, unitPrice: 250.00 },
    { name: 'DIESEL FILTER GUARD 296', category: 'Non-Fuel', costPrice: 240.00, unitPrice: 370.00 },
    { name: 'DIESEL FILTER GUARD 796', category: 'Non-Fuel', costPrice: 476.66, unitPrice: 650.00 },
    { name: 'DIESEL LUBE HD-50 10 LTR', category: 'Non-Fuel', costPrice: 6612.04, unitPrice: 7150.00 },
    { name: 'DIESEL LUBE HD-50 4 LTR', category: 'Non-Fuel', costPrice: 2644.82, unitPrice: 2860.00 },
    { name: 'FILTER 0060', category: 'Non-Fuel', costPrice: 315.00, unitPrice: 530.00 },
    { name: 'FILTER 1010', category: 'Non-Fuel', costPrice: 520.00, unitPrice: 650.00 },
    { name: 'FILTER 116', category: 'Non-Fuel', costPrice: 260.00, unitPrice: 350.00 },
    { name: 'FILTER 158', category: 'Non-Fuel', costPrice: 330.00, unitPrice: 400.00 },
    { name: 'FILTER 197', category: 'Non-Fuel', costPrice: 400.00, unitPrice: 600.00 },
    { name: 'FILTER 2003', category: 'Non-Fuel', costPrice: 850.00, unitPrice: 1050.00 },
    { name: 'FILTER 2027', category: 'Non-Fuel', costPrice: 600.00, unitPrice: 700.00 },
    { name: 'FILTER 224', category: 'Non-Fuel', costPrice: 450.00, unitPrice: 550.00 },
    { name: 'FILTER 501', category: 'Non-Fuel', costPrice: 480.00, unitPrice: 550.00 },
    { name: 'FILTER FOR AMBULANCE', category: 'Non-Fuel', costPrice: 1200.00, unitPrice: 2000.00 },
    { name: 'FILTER FOR LOADER RICKSHAW', category: 'Non-Fuel', costPrice: 160.00, unitPrice: 200.00 },
    { name: 'FILTER JALI FOAM BIKE 125', category: 'Non-Fuel', costPrice: 110.00, unitPrice: 150.00 },
    { name: 'FILTER P 407', category: 'Non-Fuel', costPrice: 750.00, unitPrice: 1000.00 },
    { name: 'FUEL FILTER 213', category: 'Non-Fuel', costPrice: 610.00, unitPrice: 800.00 },
    { name: 'FUEL FILTER 222', category: 'Non-Fuel', costPrice: 600.00, unitPrice: 700.00 },
    { name: 'GEAR OIL EP-140 (GL 4) 1LTR', category: 'Non-Fuel', costPrice: 900.00, unitPrice: 1000.00 },
    { name: 'GEARTEC GEAR OIL  SAE 85W-140', category: 'Non-Fuel', costPrice: 997.24, unitPrice: 1050.00 },
    { name: 'GENERATOR OIL 1 LTR', category: 'Non-Fuel', costPrice: 788.00, unitPrice: 810.00 },
    { name: 'GUARD DIESEL FILTER 440', category: 'Non-Fuel', costPrice: 520.00, unitPrice: 700.00 },
    { name: 'GUARD FILTER 163', category: 'Non-Fuel', costPrice: 275.00, unitPrice: 550.00 },
    { name: 'GUARD FILTER 2056', category: 'Non-Fuel', costPrice: 710.00, unitPrice: 1000.00 },
    { name: 'GUARD OIL FILTER no. 151', category: 'Non-Fuel', costPrice: 352.00, unitPrice: 450.00 },
    { name: 'HIGH S NEW MODEL', category: 'Non-Fuel', costPrice: 450.00, unitPrice: 650.00 },
    { name: 'HYDROLIC OIL', category: 'Non-Fuel', costPrice: 780.00, unitPrice: 850.00 },
    { name: 'MOTOR BIKE AIR FILTER', category: 'Non-Fuel', costPrice: 55.00, unitPrice: 100.00 },
    { name: 'MOTOR OIL 30740 SC/CC 210 LTR', category: 'Non-Fuel', costPrice: 493.56, unitPrice: 600.00 },
    { name: 'NEW XLI AC', category: 'Non-Fuel', costPrice: 190.00, unitPrice: 400.00 },
    { name: 'NPR OIL FILTER', category: 'Non-Fuel', costPrice: 900.00, unitPrice: 1200.00 },
    { name: 'OIL FILTER 161', category: 'Non-Fuel', costPrice: 850.00, unitPrice: 1100.00 },
    { name: 'OIL FILTER 198', category: 'Non-Fuel', costPrice: 521.50, unitPrice: 650.00 },
    { name: 'OIL FILTER 2012', category: 'Non-Fuel', costPrice: 360.00, unitPrice: 650.00 },
    { name: 'OIL FILTER 333', category: 'Non-Fuel', costPrice: 700.00, unitPrice: 800.00 },
    { name: 'OIL FILTER GUARD 158', category: 'Non-Fuel', costPrice: 330.00, unitPrice: 460.00 },
    { name: 'OIL FILTER GUARD 506', category: 'Non-Fuel', costPrice: 612.00, unitPrice: 700.00 },
    { name: 'OIL FILTER GUARD no. 171', category: 'Non-Fuel', costPrice: 630.00, unitPrice: 700.00 },
    { name: 'OIL FILTER GUARD no. 501', category: 'Non-Fuel', costPrice: 485.00, unitPrice: 570.00 },
    { name: 'PREMIER MOTOR OIL 4 LTR', category: 'Non-Fuel', costPrice: 850.00, unitPrice: 960.00 },
    { name: 'RIVO DALA DIESEL FILTER 070', category: 'Non-Fuel', costPrice: 750.00, unitPrice: 800.00 },
    { name: 'RIVO RICKSHAW AIR FILTER', category: 'Non-Fuel', costPrice: 600.00, unitPrice: 1200.00 },
    { name: 'TOTOTA DIESEL FILTER LO 70', category: 'Non-Fuel', costPrice: 450.00, unitPrice: 800.00 },
    { name: 'TOTOTA Hino Oil Filter', category: 'Non-Fuel', costPrice: 1064.29, unitPrice: 2100.00 },
    { name: 'VIGO AC FILTER', category: 'Non-Fuel', costPrice: 200.00, unitPrice: 450.00 },
    { name: 'VIGO AIR FILTERS', category: 'Non-Fuel', costPrice: 950.00, unitPrice: 1200.00 },
    { name: 'VIGO DIESEL FILTER LARGE', category: 'Non-Fuel', costPrice: 450.00, unitPrice: 650.00 },
    { name: 'VIGO DIESEL FILTERS', category: 'Non-Fuel', costPrice: 350.00, unitPrice: 700.00 },
    { name: 'WAGON AIR FILTER', category: 'Non-Fuel', costPrice: 250.00, unitPrice: 450.00 },
    { name: 'YARIS FILTER', category: 'Non-Fuel', costPrice: 470.00, unitPrice: 1000.00 },
];
function seedInventory() {
    return __awaiter(this, void 0, void 0, function () {
        var organization, fuelCount, nonFuelCount, duplicateCount, _i, INVENTORY_DATA_1, item, isFuel, prefix, counter, sku, error_1, error_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 8, 9, 11]);
                    console.log('🚀 Starting inventory seed...\n');
                    return [4 /*yield*/, prisma.organization.findFirst()];
                case 1:
                    organization = _a.sent();
                    if (!organization) {
                        throw new Error('No organization found');
                    }
                    console.log("\u2705 Organization: ".concat(organization.name, "\n"));
                    fuelCount = 0;
                    nonFuelCount = 0;
                    duplicateCount = 0;
                    _i = 0, INVENTORY_DATA_1 = INVENTORY_DATA;
                    _a.label = 2;
                case 2:
                    if (!(_i < INVENTORY_DATA_1.length)) return [3 /*break*/, 7];
                    item = INVENTORY_DATA_1[_i];
                    isFuel = item.category === 'Fuel';
                    prefix = isFuel ? 'FUEL' : 'NONFUEL';
                    counter = isFuel ? ++fuelCount : ++nonFuelCount;
                    sku = "".concat(prefix, "-").concat(String(counter).padStart(3, '0'));
                    _a.label = 3;
                case 3:
                    _a.trys.push([3, 5, , 6]);
                    return [4 /*yield*/, prisma.product.create({
                            data: {
                                organizationId: organization.id,
                                sku: sku,
                                name: item.name,
                                category: item.category,
                                unitPrice: item.unitPrice,
                                costPrice: item.costPrice > 0 ? item.costPrice : null,
                                isActive: true,
                                lowStockThreshold: isFuel ? null : 10,
                            },
                        })];
                case 4:
                    _a.sent();
                    console.log("\u2705 ".concat(sku, ": ").concat(item.name));
                    return [3 /*break*/, 6];
                case 5:
                    error_1 = _a.sent();
                    if (error_1.code === 'P2002') {
                        duplicateCount++;
                        console.log("\u26A0\uFE0F  SKIP: ".concat(item.name, " (duplicate)"));
                    }
                    else {
                        console.error("\u274C ERROR: ".concat(item.name, " - ").concat(error_1.message));
                    }
                    return [3 /*break*/, 6];
                case 6:
                    _i++;
                    return [3 /*break*/, 2];
                case 7:
                    console.log("\n\u2705 Imported ".concat(fuelCount + nonFuelCount - duplicateCount, " products"));
                    console.log("\u26A0\uFE0F  Skipped ".concat(duplicateCount, " duplicates"));
                    return [3 /*break*/, 11];
                case 8:
                    error_2 = _a.sent();
                    console.error('❌ Seed failed:', error_2);
                    throw error_2;
                case 9: return [4 /*yield*/, prisma.$disconnect()];
                case 10:
                    _a.sent();
                    return [7 /*endfinally*/];
                case 11: return [2 /*return*/];
            }
        });
    });
}
seedInventory();
