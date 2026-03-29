import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Gauge } from 'lucide-react';
import { meterReadingsApi } from '@/api';

export function MeterReadings() {
  const { data, isLoading } = useQuery({
    queryKey: ['meterReadings', 1],
    queryFn: () => meterReadingsApi.getAll({ page: 1, size: 20 }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Meter Readings</h1>
          <p className="text-muted-foreground">Track fuel meter readings and shifts</p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Record Reading
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>All Readings</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(10)].map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nozzle</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Meter Value</TableHead>
                  <TableHead>Recorded At</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.items.map((reading) => (
                  <TableRow key={reading.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center">
                        <Gauge className="mr-2 h-4 w-4 text-muted-foreground" />
                        {reading.nozzle?.nozzle_number || '-'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{reading.reading_type}</Badge>
                    </TableCell>
                    <TableCell>{reading.reading_value} L</TableCell>
                    <TableCell>-</TableCell>
                    <TableCell>
                      <Badge variant={reading.is_verified ? 'default' : 'secondary'}>
                        {reading.is_verified ? 'Verified' : 'Pending'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
