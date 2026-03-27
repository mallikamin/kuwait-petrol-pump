import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function MeterReadings() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Meter Readings</h1>
        <p className="text-muted-foreground">View and verify meter readings</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Meter Readings</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Meter readings management coming soon...</p>
        </CardContent>
      </Card>
    </div>
  );
}
