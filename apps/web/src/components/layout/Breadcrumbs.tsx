import { ChevronRight, Home } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { Fragment } from 'react';

const routeNames: Record<string, string> = {
  '': 'Dashboard',
  branches: 'Branches',
  'fuel-prices': 'Fuel Prices',
  shifts: 'Shifts',
  'meter-readings': 'Meter Readings',
  sales: 'Sales',
  customers: 'Customers',
  products: 'Products',
  bifurcation: 'Bifurcation',
  reports: 'Reports',
  users: 'Users',
};

export function Breadcrumbs() {
  const location = useLocation();
  const pathnames = location.pathname.split('/').filter((x) => x);

  return (
    <nav className="flex items-center space-x-2 text-sm text-muted-foreground">
      <Link to="/" className="flex items-center hover:text-foreground transition-colors">
        <Home className="h-4 w-4" />
      </Link>

      {pathnames.map((pathname, index) => {
        const routeTo = `/${pathnames.slice(0, index + 1).join('/')}`;
        const isLast = index === pathnames.length - 1;
        const name = routeNames[pathname] || pathname;

        return (
          <Fragment key={routeTo}>
            <ChevronRight className="h-4 w-4" />
            {isLast ? (
              <span className="font-medium text-foreground">{name}</span>
            ) : (
              <Link to={routeTo} className="hover:text-foreground transition-colors">
                {name}
              </Link>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
