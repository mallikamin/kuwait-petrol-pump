import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';

export function Shifts() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Shifts</h1>
          <p className="text-muted-foreground">Manage shifts and attendance</p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Open Shift
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Active Shifts</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Shift management coming soon...</p>
        </CardContent>
      </Card>
    </div>
  );
}
