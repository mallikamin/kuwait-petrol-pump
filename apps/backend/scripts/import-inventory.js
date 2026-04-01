"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
var XLSX = __importStar(require("xlsx"));
var client_1 = require("@prisma/client");
var path = __importStar(require("path"));
var prisma = new client_1.PrismaClient();
function importInventory() {
    return __awaiter(this, void 0, void 0, function () {
        var organization, excelPath, workbook, sheetName, worksheet, data, products, skippedRows, i, row, name_1, costPrice, unitPrice, category, fuelProducts, nonFuelProducts, successCount, duplicateCount, errorCount, i, product, sku, error_1, i, product, sku, error_2, error_3;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 14, 15, 17]);
                    console.log('🚀 Starting inventory import...\n');
                    return [4 /*yield*/, prisma.organization.findFirst()];
                case 1:
                    organization = _b.sent();
                    if (!organization) {
                        throw new Error('No organization found in database. Please create an organization first.');
                    }
                    console.log("\u2705 Using organization: ".concat(organization.name, " (").concat(organization.id, ")\n"));
                    excelPath = path.join(__dirname, '../../../data/inventory-list.xlsx');
                    console.log("\uD83D\uDCD6 Reading Excel file: ".concat(excelPath));
                    workbook = XLSX.readFile(excelPath);
                    sheetName = workbook.SheetNames[0];
                    worksheet = workbook.Sheets[sheetName];
                    data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                    console.log("\uD83D\uDCCA Total rows in Excel: ".concat(data.length, "\n"));
                    products = [];
                    skippedRows = 0;
                    for (i = 2; i < Math.min(data.length, 102); i++) {
                        row = data[i];
                        name_1 = (_a = row[3]) === null || _a === void 0 ? void 0 : _a.toString().trim();
                        costPrice = parseFloat(row[4] || '0');
                        unitPrice = parseFloat(row[5] || '0');
                        // Skip rows with missing or invalid data
                        if (!name_1 || name_1 === '' || isNaN(unitPrice)) {
                            skippedRows++;
                            continue;
                        }
                        category = (name_1 === 'HSD' || name_1 === 'PMG') ? 'Fuel' : 'Non-Fuel';
                        products.push({
                            name: name_1,
                            costPrice: isNaN(costPrice) ? 0 : costPrice,
                            unitPrice: unitPrice,
                            category: category,
                        });
                    }
                    console.log("\u2705 Extracted ".concat(products.length, " valid products"));
                    console.log("\u26A0\uFE0F  Skipped ".concat(skippedRows, " invalid rows\n"));
                    fuelProducts = products.filter(function (p) { return p.category === 'Fuel'; });
                    nonFuelProducts = products.filter(function (p) { return p.category === 'Non-Fuel'; });
                    console.log("\uD83D\uDD25 Fuel items: ".concat(fuelProducts.length));
                    console.log("\uD83D\uDCE6 Non-Fuel items: ".concat(nonFuelProducts.length, "\n"));
                    successCount = 0;
                    duplicateCount = 0;
                    errorCount = 0;
                    console.log('💾 Inserting products into database...\n');
                    i = 0;
                    _b.label = 2;
                case 2:
                    if (!(i < fuelProducts.length)) return [3 /*break*/, 7];
                    product = fuelProducts[i];
                    sku = "FUEL-".concat(String(i + 1).padStart(3, '0'));
                    _b.label = 3;
                case 3:
                    _b.trys.push([3, 5, , 6]);
                    return [4 /*yield*/, prisma.product.create({
                            data: {
                                organizationId: organization.id,
                                sku: sku,
                                name: product.name,
                                category: product.category,
                                unitPrice: product.unitPrice,
                                costPrice: product.costPrice > 0 ? product.costPrice : null,
                                isActive: true,
                                lowStockThreshold: product.category === 'Fuel' ? null : 10, // Fuel doesn't have stock threshold
                            },
                        })];
                case 4:
                    _b.sent();
                    successCount++;
                    console.log("\u2705 [".concat(successCount, "] ").concat(sku, ": ").concat(product.name, " - Rs ").concat(product.unitPrice));
                    return [3 /*break*/, 6];
                case 5:
                    error_1 = _b.sent();
                    if (error_1.code === 'P2002') {
                        // Unique constraint violation (duplicate SKU or org+sku combo)
                        duplicateCount++;
                        console.log("\u26A0\uFE0F  [SKIP] ".concat(sku, ": ").concat(product.name, " - Already exists"));
                    }
                    else {
                        errorCount++;
                        console.error("\u274C [ERROR] ".concat(sku, ": ").concat(product.name, " - ").concat(error_1.message));
                    }
                    return [3 /*break*/, 6];
                case 6:
                    i++;
                    return [3 /*break*/, 2];
                case 7:
                    i = 0;
                    _b.label = 8;
                case 8:
                    if (!(i < nonFuelProducts.length)) return [3 /*break*/, 13];
                    product = nonFuelProducts[i];
                    sku = "NONFUEL-".concat(String(i + 1).padStart(3, '0'));
                    _b.label = 9;
                case 9:
                    _b.trys.push([9, 11, , 12]);
                    return [4 /*yield*/, prisma.product.create({
                            data: {
                                organizationId: organization.id,
                                sku: sku,
                                name: product.name,
                                category: product.category,
                                unitPrice: product.unitPrice,
                                costPrice: product.costPrice > 0 ? product.costPrice : null,
                                isActive: true,
                                lowStockThreshold: 10,
                            },
                        })];
                case 10:
                    _b.sent();
                    successCount++;
                    console.log("\u2705 [".concat(successCount, "] ").concat(sku, ": ").concat(product.name, " - Rs ").concat(product.unitPrice));
                    return [3 /*break*/, 12];
                case 11:
                    error_2 = _b.sent();
                    if (error_2.code === 'P2002') {
                        duplicateCount++;
                        console.log("\u26A0\uFE0F  [SKIP] ".concat(sku, ": ").concat(product.name, " - Already exists"));
                    }
                    else {
                        errorCount++;
                        console.error("\u274C [ERROR] ".concat(sku, ": ").concat(product.name, " - ").concat(error_2.message));
                    }
                    return [3 /*break*/, 12];
                case 12:
                    i++;
                    return [3 /*break*/, 8];
                case 13:
                    // 6. Print summary
                    console.log('\n' + '='.repeat(50));
                    console.log('📊 IMPORT SUMMARY');
                    console.log('='.repeat(50));
                    console.log("\u2705 Successfully imported: ".concat(successCount));
                    console.log("\u26A0\uFE0F  Duplicates skipped: ".concat(duplicateCount));
                    console.log("\u274C Errors: ".concat(errorCount));
                    console.log("\uD83D\uDCE6 Total processed: ".concat(products.length));
                    console.log('='.repeat(50));
                    return [3 /*break*/, 17];
                case 14:
                    error_3 = _b.sent();
                    console.error('\n❌ FATAL ERROR:', error_3);
                    throw error_3;
                case 15: return [4 /*yield*/, prisma.$disconnect()];
                case 16:
                    _b.sent();
                    return [7 /*endfinally*/];
                case 17: return [2 /*return*/];
            }
        });
    });
}
// Run the import
importInventory()
    .then(function () {
    console.log('\n✅ Import completed successfully!');
    process.exit(0);
})
    .catch(function (error) {
    console.error('\n❌ Import failed:', error);
    process.exit(1);
});
