import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite configuration for the network dashboard.  The dev server runs on
// port 5173 by default.  The API base URL can be configured via
// environment variables at runtime (see src/App.tsx).

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});