import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';

export function Bifurcation() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bifurcation</h1>
          <p className="text-muted-foreground">Cash reconciliation and variance management</p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Create Bifurcation
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Pending Bifurcations</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Bifurcation management coming soon...</p>
        </CardContent>
      </Card>
    </div>
  );
}
