import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { setReportBrandProvider } from './utils/reportBranding';
import { useAuthStore } from './store/auth';

// Per-org report branding: source companyName/address from the org the user
// is *currently viewing* (org switcher), falling back to the JWT primary org,
// and finally to the legacy Absormax constants when nothing is loaded yet.
// Reads happen on every PDF/CSV render via the proxy in reportBranding.ts,
// so a runtime org switch updates branding without remounting consumers.
setReportBrandProvider(() => {
  const state = useAuthStore.getState();
  const activeOrg = state.accessibleOrgs.find((o) => o.id === state.activeOrgId);
  const fallbackOrg = state.user?.organization;
  const org = activeOrg ?? fallbackOrg ?? null;
  return {
    companyName: org?.companyName || 'Absormax Hygiene Products (Pvt) LTD',
    companyAddress: org?.companyAddress || 'Sundar Industrial Estate, Lahore',
    systemLabel: 'Kuwait Petrol Pump POS',
    reportFooter: org?.reportFooter ?? null,
  };
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
