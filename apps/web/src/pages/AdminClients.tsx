import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Users, CheckCircle2, AlertCircle, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { adminApi, AdminClientSummary, AdminUserWithOrgAccess } from '@/api/admin';
import { useAuthStore } from '@/store/auth';
import { handleApiError } from '@/api/client';

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

      {data && <CrossOrgAccessMatrix clients={data.clients} />}
    </div>
  );
}

/// Admin-only matrix for granting cross-org access to BPO/super-admin users.
/// Each row is a user; each column is an organization. The user's primary
/// org is checked + locked (you can't strip them of their own login org —
/// deactivate the user instead).
function CrossOrgAccessMatrix({ clients }: { clients: AdminClientSummary[] }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users-with-org-access'],
    queryFn: () => adminApi.listUsersWithOrgAccess(),
  });

  const setAccess = useMutation({
    mutationFn: ({ userId, orgIds }: { userId: string; orgIds: string[] }) =>
      adminApi.setUserOrgAccess(userId, orgIds),
    onMutate: ({ userId }) => setSavingUserId(userId),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'users-with-org-access'] });
      queryClient.invalidateQueries({ queryKey: ['accessible-orgs'] });
    },
    onError: (err) => setError(handleApiError(err)),
    onSettled: () => setSavingUserId(null),
  });

  // Show only roles that benefit from cross-org access. Operator/cashier/
  // accountant users are tenant-scoped by design and don't appear here.
  const eligibleUsers = useMemo(
    () => (data?.users ?? []).filter((u) => ['admin', 'manager'].includes(u.role.toLowerCase())),
    [data]
  );

  const handleToggle = (user: AdminUserWithOrgAccess, orgId: string, checked: boolean) => {
    if (user.primaryOrg?.id === orgId) return; // primary org is locked
    const current = new Set(user.grantedOrgs.map((o) => o.id));
    if (checked) {
      current.add(orgId);
    } else {
      current.delete(orgId);
    }
    setAccess.mutate({ userId: user.id, orgIds: Array.from(current) });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          Cross-Org Access Grants
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Grant admin / BPO users access to additional organizations. Their primary org
          is always included (locked). Operator, cashier, and accountant users stay
          tenant-scoped and don't appear here.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-32" />
        ) : eligibleUsers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No admin/manager users found. Cross-org access is meaningful only for those roles.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[200px]">User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Primary Org</TableHead>
                  {clients.map((c) => (
                    <TableHead key={c.id} className="text-center">
                      {c.name}
                      {c.code && (
                        <code className="ml-1 text-xs bg-muted px-1 rounded">{c.code}</code>
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {eligibleUsers.map((u) => {
                  const grantedIds = new Set([
                    u.primaryOrg?.id,
                    ...u.grantedOrgs.map((o) => o.id),
                  ].filter(Boolean) as string[]);
                  const saving = savingUserId === u.id;
                  return (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">
                        <div>{u.username}</div>
                        {u.fullName && (
                          <div className="text-xs text-muted-foreground">{u.fullName}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">{u.role}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {u.primaryOrg?.name ?? '—'}
                      </TableCell>
                      {clients.map((c) => {
                        const isPrimary = u.primaryOrg?.id === c.id;
                        const checked = grantedIds.has(c.id);
                        return (
                          <TableCell key={c.id} className="text-center">
                            <Checkbox
                              checked={checked}
                              disabled={isPrimary || saving}
                              onCheckedChange={(v) => handleToggle(u, c.id, v === true)}
                              title={isPrimary ? 'Primary org — always granted' : ''}
                            />
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {error && <p className="text-sm text-destructive mt-4">{error}</p>}
      </CardContent>
    </Card>
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
