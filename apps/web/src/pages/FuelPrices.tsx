import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';

export function FuelPrices() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Fuel Prices</h1>
          <p className="text-muted-foreground">Manage fuel pricing and history</p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Update Price
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Current Prices</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Fuel price management coming soon...</p>
        </CardContent>
      </Card>
    </div>
  );
}
