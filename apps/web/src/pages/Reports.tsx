import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileText, Download } from 'lucide-react';

export function Reports() {
  const reports = [
    { name: 'Daily Sales Summary', description: 'Sales by fuel type, payment method' },
    { name: 'Variance Report', description: 'Meter readings vs sales variance' },
    { name: 'Meter Reading Report', description: 'All meter readings by shift' },
    { name: 'Customer Credit Report', description: 'Outstanding credit balances' },
    { name: 'Product Sales Report', description: 'Non-fuel product sales' },
    { name: 'Shift Summary Report', description: 'Sales by shift and cashier' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
        <p className="text-muted-foreground">Generate and download reports</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {reports.map((report, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                <div className="flex items-center">
                  <FileText className="mr-2 h-4 w-4 text-muted-foreground" />
                  {report.name}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-4">{report.description}</p>
              <Button size="sm" variant="outline" className="w-full">
                <Download className="mr-2 h-4 w-4" />
                Generate
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
