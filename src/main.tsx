import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import App from './App';
import QuoteComparisonApp from './quotes/QuoteComparisonApp';
import {QUOTE_COMPARISON_PATH} from './quotes/quoteLink';
import './index.css';
import {
	applyDocumentBranding,
	buildBrandingFromTeam,
	getDialerBranding,
	isPlainBranding,
	setDynamicDialerBranding
} from './branding';
import {resolveBrandingByHostnamePublic} from '@/lib/api';

// Authenticated branding is resolved by the session provider after handoff.
// Do not race a public-host response against the authenticated session.
if (window.location.pathname.replace(/\/+$/, '') === QUOTE_COMPARISON_PATH) {
  void resolveBrandingByHostnamePublic(window.location.host).then((res) => {
    setDynamicDialerBranding(res?.branding ? buildBrandingFromTeam(res.branding) : null);
    applyDocumentBranding(isPlainBranding(), getDialerBranding());
  });
}

applyDocumentBranding(isPlainBranding(), getDialerBranding());

// The quote comparison page (ENG-286) opens in its own tab and must NOT mount
// <App/>: App's tab lock would show the duplicate-tab screen, and its session
// provider would register a second voice device.
const isQuoteComparison =
	window.location.pathname.replace(/\/+$/, '') === QUOTE_COMPARISON_PATH;

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		{isQuoteComparison ? (
			<QuoteComparisonApp />
		) : (
			<BrowserRouter>
				<App />
			</BrowserRouter>
		)}
	</StrictMode>
);
