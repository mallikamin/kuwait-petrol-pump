import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Building2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { branchesApi } from '@/api';
import { handleApiError } from '@/api/client';
import { useAuthStore } from '@/store/auth';

export function Branches() {
  const page = 1; // TODO: Add pagination
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role?.toLowerCase() === 'admin';

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [location, setLocation] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['branches', page],
    queryFn: () => branchesApi.getAll({ page, size: 20 }),
  });

  const createBranch = useMutation({
    mutationFn: () =>
      branchesApi.create({
        name: name.trim(),
        code: code.trim() || null,
        location: location.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branches'] });
      setOpen(false);
      setName('');
      setCode('');
      setLocation('');
      setError(null);
    },
    onError: (err) => setError(handleApiError(err)),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    createBranch.mutate();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Branches</h1>
          <p className="text-muted-foreground">Manage your petrol pump branches</p>
        </div>
        {isAdmin && (
          <Button onClick={() => setOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Branch
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Branches</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.items?.map((branch: any) => (
                  <TableRow key={branch.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center">
                        <Building2 className="mr-2 h-4 w-4 text-muted-foreground" />
                        {branch.name}
                      </div>
                    </TableCell>
                    <TableCell>{branch.code ?? '—'}</TableCell>
                    <TableCell>{branch.location ?? branch.address ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={(branch.is_active ?? branch.isActive ?? true) ? 'success' : 'destructive'}>
                        {(branch.is_active ?? branch.isActive ?? true) ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setError(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Branch</DialogTitle>
            <DialogDescription>
              Create a new branch within your organization. Code must be unique within the org (e.g. b02).
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="branch-name">Name *</Label>
              <Input
                id="branch-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Main Branch"
                autoFocus
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="branch-code">Code</Label>
              <Input
                id="branch-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="b02"
                maxLength={32}
              />
              <p className="text-xs text-muted-foreground">Lowercased on save. Used in usernames (e.g. org-code-001).</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="branch-location">Location</Label>
              <Input
                id="branch-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Lahore, Pakistan"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createBranch.isPending}>
                {createBranch.isPending ? 'Creating…' : 'Create Branch'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
