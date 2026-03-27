import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SalesChart as SalesChartData } from '@/types';

interface SalesChartProps {
  data: SalesChartData[];
}

export function SalesChart({ data }: SalesChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Today's Sales</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="hour" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="fuel" stroke="#8884d8" name="Fuel Sales" />
            <Line type="monotone" dataKey="products" stroke="#82ca9d" name="Product Sales" />
            <Line type="monotone" dataKey="total" stroke="#ffc658" name="Total Sales" />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
