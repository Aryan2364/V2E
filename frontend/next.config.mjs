/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit .next/standalone: a server.js plus only the traced node_modules files,
  // which is all the Dockerfile's runner stage ships. Does not affect `next dev`
  // or `next start`; it only adds an extra output directory at build time.
  output: 'standalone',
  experimental: { workerThreads: false, cpus: 1 },
  transpilePackages: ['reactflow', '@reactflow/core', '@reactflow/background', '@reactflow/controls', '@reactflow/minimap'],
  images: {
    domains: ['localhost'],
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/:path*`,
      },
    ];
  },
  async redirects() {
    return [
      // Configuration moved into the Settings area (gear icon) with two modules:
      // Organization Setup (HR-handoverable) and System Configuration (admin-only).
      // Keep old Foundation/dashboard bookmarks working.
      { source: '/dashboard/holidays/:path*', destination: '/settings/organization/holidays/:path*', permanent: false },
      { source: '/dashboard/holidays', destination: '/settings/organization/holidays', permanent: false },

      { source: '/foundation/identity', destination: '/settings/organization/company', permanent: false },
      { source: '/foundation/culture', destination: '/settings/organization/culture', permanent: false },
      { source: '/foundation/org-chart', destination: '/settings/organization/structure', permanent: false },
      { source: '/foundation/roles/:path*', destination: '/settings/organization/roles/:path*', permanent: false },
      { source: '/foundation/roles', destination: '/settings/organization/roles', permanent: false },
      { source: '/foundation/employees/:path*', destination: '/settings/organization/employees/:path*', permanent: false },
      { source: '/foundation/employees', destination: '/settings/organization/employees', permanent: false },
      { source: '/foundation/holidays/:path*', destination: '/settings/organization/holidays/:path*', permanent: false },
      { source: '/foundation/holidays', destination: '/settings/organization/holidays', permanent: false },
      { source: '/foundation/access-rights', destination: '/settings/system/access-rights', permanent: false },
      { source: '/foundation/audit-logs', destination: '/settings/system/audit-logs', permanent: false },
      // Anything else under Foundation (incl. its index) lands on the Settings entry point.
      { source: '/foundation/:path*', destination: '/settings', permanent: false },
      { source: '/foundation', destination: '/settings', permanent: false },
    ];
  },
};

export default nextConfig;
