import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Calculator } from 'lucide-react';

export function Bifurcation() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bifurcation</h1>
          <p className="text-muted-foreground">End-of-day sales allocation (Cash/Credit/Card)</p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          New Bifurcation
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Bifurcation Process</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start space-x-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
              1
            </div>
            <div>
              <h3 className="font-semibold">Record Total Sales</h3>
              <p className="text-sm text-muted-foreground">Enter total PMG and HSD liters sold</p>
            </div>
          </div>
          <div className="flex items-start space-x-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
              2
            </div>
            <div>
              <h3 className="font-semibold">Review Credit Sales</h3>
              <p className="text-sm text-muted-foreground">Accountant reviews all credit sale invoices (petrol pump slips)</p>
            </div>
          </div>
          <div className="flex items-start space-x-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
              3
            </div>
            <div>
              <h3 className="font-semibold">Enter Card Transactions</h3>
              <p className="text-sm text-muted-foreground">Enter bank cards and pump cards</p>
            </div>
          </div>
          <div className="flex items-start space-x-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
              4
            </div>
            <div>
              <h3 className="font-semibold">Calculate Cash</h3>
              <p className="text-sm text-muted-foreground">Remaining balance is automatically allocated to cash</p>
            </div>
          </div>

          <div className="pt-4">
            <Button className="w-full" size="lg">
              <Calculator className="mr-2 h-5 w-5" />
              Start Bifurcation Wizard
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
