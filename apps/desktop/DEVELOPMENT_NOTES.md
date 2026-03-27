# Development Notes - Kuwait Petrol POS Desktop

## Architecture Decisions

### Why Electron?
- Cross-platform deployment (Windows, macOS, Linux)
- Access to native OS features (printing, file system)
- Offline capability potential
- Single codebase for desktop

### Why React Query?
- Automatic caching reduces API calls
- Background refetching
- Optimistic updates support
- Stale-while-revalidate pattern
- Query invalidation on mutations

### Why Zustand over Redux?
- Simpler API (less boilerplate)
- Better TypeScript support
- Built-in persistence middleware
- Smaller bundle size
- Easier to understand for new developers

### Why Vite over Webpack?
- Faster dev server startup
- Hot Module Replacement (HMR) is instant
- Smaller production builds
- Native ESM support
- Better developer experience

## Code Patterns

### API Call Pattern
```typescript
// 1. Define endpoint in endpoints.ts
export const exampleApi = {
  getData: (id: string) => apiClient.get(`/example/${id}`),
};

// 2. Use in component with React Query
const { data, isLoading, error } = useQuery({
  queryKey: ['example', id],
  queryFn: () => exampleApi.getData(id),
});

// 3. Mutate with invalidation
const mutation = useMutation({
  mutationFn: (data) => exampleApi.create(data),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['example'] });
  },
});
```

### Form Pattern
```typescript
// 1. State for form fields
const [formData, setFormData] = useState({ name: '', email: '' });

// 2. Submit handler
const handleSubmit = (e: React.FormEvent) => {
  e.preventDefault();
  mutation.mutate(formData);
};

// 3. Input binding
<Input
  value={formData.name}
  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
/>
```

### Store Pattern
```typescript
// 1. Define store with Zustand
export const useExampleStore = create<State>()(
  persist(
    (set) => ({
      items: [],
      addItem: (item) => set((state) => ({
        items: [...state.items, item]
      })),
    }),
    { name: 'example-storage' }
  )
);

// 2. Use in component
const { items, addItem } = useExampleStore();
```

## Common Tasks

### Adding a New Screen

1. **Create screen component:**
```bash
touch src/renderer/screens/NewScreen.tsx
```

2. **Implement screen:**
```typescript
export const NewScreen: React.FC = () => {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">New Screen</h1>
      {/* Content */}
    </div>
  );
};
```

3. **Add route in App.tsx:**
```typescript
import { NewScreen } from './screens/NewScreen';

// In Routes:
<Route path="/new-screen" element={
  <ProtectedRoute>
    <Layout><NewScreen /></Layout>
  </ProtectedRoute>
} />
```

4. **Add to navigation in Layout.tsx:**
```typescript
const navigation = [
  // ...
  { name: 'New Screen', href: '/new-screen', icon: IconName, roles: ['admin'] },
];
```

### Adding a New API Endpoint

1. **Add to endpoints.ts:**
```typescript
export const newApi = {
  getItems: (params) => apiClient.get('/new-endpoint', { params }),
  createItem: (data) => apiClient.post('/new-endpoint', data),
  updateItem: (id, data) => apiClient.put(`/new-endpoint/${id}`, data),
  deleteItem: (id) => apiClient.delete(`/new-endpoint/${id}`),
};
```

2. **Add types to types.ts:**
```typescript
export interface NewItem {
  id: string;
  name: string;
  // ...
}
```

### Adding a New UI Component

1. **Create in components/ui/:**
```typescript
// src/renderer/components/ui/NewComponent.tsx
export const NewComponent = ({ prop1, prop2 }) => {
  return <div>{/* ... */}</div>;
};
```

2. **Use TailwindCSS classes**
3. **Export and use in screens**

### Debugging API Issues

1. **Check Network Tab in DevTools:**
```
Ctrl+Shift+I → Network tab
Look for failed requests (red)
Check request/response headers and body
```

2. **Check Console for Errors:**
```
Console tab → Look for error messages
Check if API URL is correct
Verify token is being sent
```

3. **Test API directly:**
```bash
# Login first
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@petrolpump.com","password":"password123"}'

# Use token in subsequent requests
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3000/api/branches
```

### Adding Print Functionality

**Current Setup:**
- IPC handler exists in `src/main/index.ts`
- `window.api.printReceipt(data)` available in renderer

**To Implement:**
1. Install thermal printer driver package
2. Configure printer settings in main process
3. Format receipt template (ESC/POS commands)
4. Test with actual printer hardware

**Example:**
```typescript
// In main/index.ts
ipcMain.handle('print-receipt', async (_, data) => {
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: 'tcp://192.168.1.100',
  });

  printer.alignCenter();
  printer.println('Kuwait Petrol Pump');
  printer.println(`Sale: ${data.saleNumber}`);
  // ... format receipt
  printer.cut();

  await printer.execute();
  return { success: true };
});
```

## Performance Optimization Tips

### 1. React Query Cache
```typescript
// Reduce refetch interval for less critical data
const { data } = useQuery({
  queryKey: ['example'],
  queryFn: fetchData,
  refetchInterval: 60000, // 60 seconds instead of 30
  staleTime: 30000,       // Data fresh for 30s
});
```

### 2. Debounce Search Inputs
```typescript
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

const [search, setSearch] = useState('');
const debouncedSearch = useDebouncedValue(search, 500);

useQuery({
  queryKey: ['search', debouncedSearch],
  queryFn: () => searchApi(debouncedSearch),
  enabled: debouncedSearch.length >= 2,
});
```

### 3. Pagination
```typescript
// Implement pagination for large lists
const [page, setPage] = useState(0);
const { data } = useQuery({
  queryKey: ['items', page],
  queryFn: () => api.getItems({ limit: 50, offset: page * 50 }),
});
```

### 4. Lazy Loading
```typescript
// Use React.lazy for code splitting
const Reports = React.lazy(() => import('./screens/Reports'));

// In routes:
<Route path="/reports" element={
  <Suspense fallback={<Loading />}>
    <Reports />
  </Suspense>
} />
```

## Security Considerations

### Token Storage
- **Current**: Zustand persist (localStorage)
- **Better**: Electron's safeStorage API for production
- **Best**: Hardware security module for enterprise

### Content Security Policy
- Already configured in `index.html`
- Restricts external resources
- Prevents XSS attacks

### API Communication
- Always use HTTPS in production
- Validate all user inputs
- Sanitize data before rendering
- Never trust client-side data

## Testing Strategy

### Unit Tests (TODO)
```bash
# Install testing library
npm install --save-dev @testing-library/react @testing-library/jest-dom vitest

# Create test files alongside components
# Example: Button.test.tsx
```

### Integration Tests (TODO)
```bash
# Test API integration
# Mock backend responses
# Test complete user flows
```

### E2E Tests (TODO)
```bash
# Use Playwright or Cypress
# Test real user scenarios
# Automated testing before releases
```

## Deployment Checklist

### Before Building
- [ ] Update version in package.json
- [ ] Test all features manually
- [ ] Check console for warnings/errors
- [ ] Verify API endpoints are correct
- [ ] Test with production API URL
- [ ] Update environment variables
- [ ] Review security settings

### Build Process
```bash
# Clean previous builds
rm -rf dist dist-electron

# Build
npm run build

# Package for target platform
npm run package:win   # or :mac or :linux

# Test the packaged app
# Install and run on clean machine
```

### Post-Build
- [ ] Test installer on target OS
- [ ] Verify app launches correctly
- [ ] Test update mechanism (if implemented)
- [ ] Check file sizes (optimize if needed)
- [ ] Create release notes
- [ ] Tag version in git

## Common Errors & Solutions

### Error: "Cannot find module '@/...'"
**Solution:** Check tsconfig.json paths configuration
```json
{
  "paths": {
    "@/*": ["./src/renderer/*"],
    "@shared/*": ["./src/shared/*"]
  }
}
```

### Error: "window.api is not defined"
**Solution:** Check preload script is loaded
```typescript
// In main/index.ts
webPreferences: {
  preload: join(__dirname, '../preload/index.js'),
}
```

### Error: "401 Unauthorized"
**Solution:** Token expired or invalid
```typescript
// Check authStore has valid token
const { token } = useAuthStore();
console.log('Token:', token);

// Logout and login again
```

### Error: "Network Error"
**Solution:** Backend not running or CORS issue
```bash
# Check backend is running
curl http://localhost:3000/api/branches

# Check CORS in backend
# Add Electron's origin to allowed origins
```

## Environment Variables

### Development (.env)
```env
VITE_API_URL=http://localhost:3000/api
NODE_ENV=development
```

### Production (.env.production)
```env
VITE_API_URL=https://api.kuwaitpetrol.com/api
NODE_ENV=production
```

### Usage in Code
```typescript
const API_URL = import.meta.env.VITE_API_URL;
const IS_DEV = import.meta.env.DEV;
const IS_PROD = import.meta.env.PROD;
```

## Git Workflow

### Branch Strategy
```
main        - Production ready
develop     - Integration branch
feature/*   - New features
bugfix/*    - Bug fixes
hotfix/*    - Urgent production fixes
```

### Commit Messages
```
feat: Add customer management screen
fix: Resolve token refresh issue
docs: Update README with setup instructions
style: Format code with Prettier
refactor: Simplify API client logic
test: Add unit tests for Button component
chore: Update dependencies
```

## Resources

### Documentation
- **Electron**: https://www.electronjs.org/docs
- **React Query**: https://tanstack.com/query/latest
- **Zustand**: https://docs.pmnd.rs/zustand
- **TailwindCSS**: https://tailwindcss.com/docs

### Tools
- **DevTools**: Ctrl+Shift+I in Electron
- **React DevTools**: Browser extension
- **Redux DevTools**: For Zustand (with middleware)

### Community
- Electron Discord
- React community forums
- Stack Overflow

## Future Improvements

### Short Term (1-2 weeks)
- [ ] Implement Reports screen
- [ ] Implement Bifurcation screen
- [ ] Implement Settings screen
- [ ] Add thermal printer driver
- [ ] Add unit tests

### Medium Term (1-2 months)
- [ ] Offline mode with sync
- [ ] OCR integration for meter readings
- [ ] Multi-language support (Arabic/English)
- [ ] Dark mode theme
- [ ] Auto-update mechanism

### Long Term (3-6 months)
- [ ] Advanced analytics dashboard
- [ ] Mobile companion app
- [ ] Cloud backup/restore
- [ ] Multi-branch management
- [ ] Role-based UI customization

## Maintenance

### Regular Tasks
- **Weekly**: Check for dependency updates
- **Monthly**: Review error logs, optimize queries
- **Quarterly**: Major dependency updates, security audit
- **Yearly**: Performance review, UX improvements

### Monitoring
- Track API response times
- Monitor error rates
- Collect user feedback
- Review crash reports

---

**Last Updated**: March 26, 2026
**Maintained By**: Development Team
**Version**: 1.0.0
