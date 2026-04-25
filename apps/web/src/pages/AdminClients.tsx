import { useQuery } from '@tanstack/react-query';
import { Building2, Users, CheckCircle2, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { adminApi, AdminClientSummary } from '@/api/admin';
import { useAuthStore } from '@/store/auth';

/// Master Client List — admin-only directory of every tenant in the pool.
/// Read-only for now; onboarding lives in scripts/onboarding/* CLI tools.
/// A creation UI is a planned follow-up once the multi-tenant foundation
/// has been smoke-tested in production.
export function AdminClients() {
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin';

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'clients'],
    queryFn: () => adminApi.listClients(),
    enabled: isAdmin,
  });

  if (!isAdmin) {
    return (
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Master Client List</h1>
        <p className="text-muted-foreground">Admin role required to view this page.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Master Client List</h1>
        <p className="text-muted-foreground">
          Every tenant in the pool. Add clients via{' '}
          <code className="text-xs bg-muted px-1 rounded">scripts/onboarding/</code> CLI scripts.
        </p>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[...Array(2)].map((_, i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive">Failed to load clients. Try refresh.</p>
          </CardContent>
        </Card>
      )}

      {data?.clients.map((client) => <ClientCard key={client.id} client={client} />)}

      {data && data.clients.length === 0 && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">No clients yet.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ClientCard({ client }: { client: AdminClientSummary }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              {client.name}
              {client.code && (
                <code className="text-xs bg-muted px-2 py-0.5 rounded">{client.code}</code>
              )}
              {client.isDemo && <Badge variant="secondary">Demo</Badge>}
              <Badge variant="outline">{client.tenancyMode}</Badge>
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {client.companyName || client.name}
              {client.companyAddress ? ` · ${client.companyAddress}` : ''}
            </p>
          </div>
          <div className="text-right text-sm">
            <div className="flex items-center gap-1 justify-end">
              <Users className="h-4 w-4" />
              <span>{client.userCount} users</span>
            </div>
            <div className="text-muted-foreground">
              {client.currency} · {client.timezone}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold mb-2">Branches ({client.branches.length})</h3>
          {client.branches.length === 0 ? (
            <p className="text-sm text-muted-foreground">No branches yet.</p>
          ) : (
            <ul className="space-y-1">
              {client.branches.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center justify-between text-sm border rounded px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    {b.code && <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{b.code}</code>}
                    <span className="font-medium">{b.name}</span>
                    {b.location && <span className="text-muted-foreground">· {b.location}</span>}
                    {!b.isActive && <Badge variant="destructive">Inactive</Badge>}
                  </div>
                  <span className="text-muted-foreground">{b.userCount} users</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="text-sm font-semibold mb-2">QuickBooks</h3>
          {client.qbConnection ? (
            <div className="flex items-center gap-2 text-sm border rounded px-3 py-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span className="font-medium">{client.qbConnection.companyName}</span>
              <span className="text-muted-foreground">· realm {client.qbConnection.realmId}</span>
              <Badge variant="outline">{client.qbConnection.syncMode}</Badge>
              {client.qbConnection.lastSyncStatus && (
                <span className="ml-auto text-xs text-muted-foreground">
                  Last sync: {client.qbConnection.lastSyncStatus}
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground border rounded px-3 py-2">
              <AlertCircle className="h-4 w-4" />
              <span>Not connected. Owner connects via the QuickBooks page.</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
