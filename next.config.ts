import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  experimental: { proxyTimeout: 180000 },
  async rewrites() {
    return [
      {
        source: '/api/playback/:path*',
        destination: `${process.env.GATEWAY_INTERNAL_URL || 'http://127.0.0.1:4001'}/api/playback/:path*`,
      },
      {
        source: '/api/:path*',
        destination: `${process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000'}/api/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};
export default config;
