/** @type {import('next').NextConfig} */
const BANKING_API = process.env.BANKING_API_URL || 'http://localhost:4000';

const nextConfig = {
  turbopack: {},

  async rewrites() {
    return [
      {
        source: '/api/banking/:path*',
        destination: `${BANKING_API}/banking/:path*`,
      },
      {
        source: '/api/webhooks/:path*',
        destination: `${BANKING_API}/webhooks/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
