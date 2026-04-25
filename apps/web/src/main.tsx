import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { setReportBrandProvider } from './utils/reportBranding';
import { useAuthStore } from './store/auth';

// Per-org report branding: source companyName/address from the logged-in
// user's organization. Falls through to the default Absormax constants
// when no user is authenticated yet (login page) or when the org payload
// is missing — preserving the legacy output exactly.
setReportBrandProvider(() => {
  const org = useAuthStore.getState().user?.organization;
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
