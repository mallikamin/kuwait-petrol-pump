import { forwardRef } from 'react';
import { formatCurrency } from '@/utils/format';

export interface ReceiptItem {
  name: string;
  sku?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface ReceiptData {
  receiptNo: string;
  date: string;
  cashier: string;
  branch: string;
  items: ReceiptItem[];
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  paymentMethod: string;
  customerName?: string;
  vehicleNumber?: string;
  slipNumber?: string;
}

interface ReceiptProps {
  data: ReceiptData;
}

const paymentLabel = (method: string) => {
  const map: Record<string, string> = {
    cash: 'Cash',
    card: 'Card',
    credit: 'Credit',
    pso_card: 'PSO Card',
    other: 'Other',
  };
  return map[method] || method;
};

export const Receipt = forwardRef<HTMLDivElement, ReceiptProps>(({ data }, ref) => {
  return (
    <div ref={ref} className="receipt-content bg-white text-black p-6 max-w-[380px] mx-auto font-mono text-sm">
      {/* Header */}
      <div className="text-center mb-4">
        <h2 className="text-lg font-bold">Kuwait Petrol Pump</h2>
        <p className="text-xs text-gray-600">{data.branch}</p>
        <div className="border-b border-dashed border-gray-400 my-2" />
        <p className="text-xs">SALES RECEIPT</p>
      </div>

      {/* Meta */}
      <div className="text-xs space-y-1 mb-3">
        <div className="flex justify-between">
          <span>Receipt #:</span>
          <span className="font-semibold">{data.receiptNo}</span>
        </div>
        <div className="flex justify-between">
          <span>Date:</span>
          <span>{data.date}</span>
        </div>
        <div className="flex justify-between">
          <span>Cashier:</span>
          <span>{data.cashier}</span>
        </div>
        {data.customerName && (
          <div className="flex justify-between">
            <span>Customer:</span>
            <span>{data.customerName}</span>
          </div>
        )}
        {data.vehicleNumber && (
          <div className="flex justify-between">
            <span>Vehicle:</span>
            <span>{data.vehicleNumber}</span>
          </div>
        )}
        {data.slipNumber && (
          <div className="flex justify-between">
            <span>Slip #:</span>
            <span>{data.slipNumber}</span>
          </div>
        )}
      </div>

      <div className="border-b border-dashed border-gray-400 my-2" />

      {/* Items */}
      <table className="w-full text-xs mb-2">
        <thead>
          <tr className="border-b border-gray-300">
            <th className="text-left py-1">Item</th>
            <th className="text-center py-1">Qty</th>
            <th className="text-right py-1">Price</th>
            <th className="text-right py-1">Total</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((item, i) => (
            <tr key={i} className="border-b border-dotted border-gray-200">
              <td className="py-1 pr-1 max-w-[140px] truncate">{item.name}</td>
              <td className="text-center py-1">{item.quantity}</td>
              <td className="text-right py-1 whitespace-nowrap">{formatCurrency(item.unitPrice)}</td>
              <td className="text-right py-1 whitespace-nowrap">{formatCurrency(item.totalPrice)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="border-b border-dashed border-gray-400 my-2" />

      {/* Totals */}
      <div className="text-xs space-y-1">
        <div className="flex justify-between">
          <span>Subtotal:</span>
          <span>{formatCurrency(data.subtotal)}</span>
        </div>
        {data.taxAmount > 0 && (
          <div className="flex justify-between">
            <span>Tax:</span>
            <span>{formatCurrency(data.taxAmount)}</span>
          </div>
        )}
        {data.discountAmount > 0 && (
          <div className="flex justify-between">
            <span>Discount:</span>
            <span>-{formatCurrency(data.discountAmount)}</span>
          </div>
        )}
        <div className="border-b border-gray-400 my-1" />
        <div className="flex justify-between text-base font-bold">
          <span>TOTAL:</span>
          <span>{formatCurrency(data.totalAmount)}</span>
        </div>
        <div className="flex justify-between">
          <span>Payment:</span>
          <span className="font-semibold">{paymentLabel(data.paymentMethod)}</span>
        </div>
      </div>

      <div className="border-b border-dashed border-gray-400 my-3" />

      {/* Footer */}
      <div className="text-center text-xs text-gray-500">
        <p>Thank you for your business!</p>
        <p className="mt-1">Kuwait Petrol Pump POS</p>
      </div>
    </div>
  );
});

Receipt.displayName = 'Receipt';
