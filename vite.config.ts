import path from 'node:path';
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src')
		}
	},
	server: {
		port: 5174,
		host: true,
		// ENG-317: allow `dialer.<brand>.localhost:5174` so the "Open Dialer"
		// button on the dashboard links to a branded dev subdomain and the
		// dialer resolves its own team-branding from that hostname.
		allowedHosts: ['.localhost']
	}
});
