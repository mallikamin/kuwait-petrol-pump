import {
  generateDeterministicSku,
  parseInventoryRows,
} from './product-import.service';

describe('product-import.service', () => {
  describe('generateDeterministicSku', () => {
    it('generates stable SKU values for same input name', () => {
      const sku1 = generateDeterministicSku('Engine Oil 20W50');
      const sku2 = generateDeterministicSku(' Engine   Oil 20W50 ');

      expect(sku1).toEqual(sku2);
      expect(sku1.startsWith('AUTO-ENGINE-OIL-20W50-')).toBe(true);
    });
  });

  describe('parseInventoryRows', () => {
    it('skips blank rows and rows with missing selling price', () => {
      const result = parseInventoryRows([
        ['No', 'SKU', 'Category', 'Product Name', 'Calculated Avg', 'Sales Price'],
        ['', '', '', '', '', ''],
        [1, '', 'Lubricants', 'Oil Filter', '250', ''],
        [2, '', 'Lubricants', 'Air Filter', '180', '240'],
      ]);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].name).toBe('Air Filter');
      expect(result.skipped).toEqual([{ rowNumber: 2, reason: 'blank_row' }]);
      expect(result.errors).toEqual([
        { rowNumber: 3, reason: 'missing_or_invalid_unit_price' },
      ]);
    });

    it('marks duplicate rows in the same sheet as skipped', () => {
      const result = parseInventoryRows([
        ['No', 'SKU', 'Category', 'Product Name', 'Calculated Avg', 'Sales Price'],
        [1, '', 'Lubricants', 'Brake Fluid', '200', '300'],
        [2, '', 'Lubricants', 'Brake Fluid', '200', '300'],
      ]);

      expect(result.rows).toHaveLength(1);
      expect(result.skipped).toEqual([
        { rowNumber: 3, reason: 'duplicate_row_in_file' },
      ]);
    });

    it('uses fixed D/E/F mapping when header row is missing', () => {
      const result = parseInventoryRows([
        [1, '', 'Car Care', 'Coolant', '400', '550'],
      ]);

      expect(result.errors).toHaveLength(0);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        name: 'Coolant',
        category: 'Car Care',
        costPrice: 400,
        unitPrice: 550,
      });
    });
  });
});
