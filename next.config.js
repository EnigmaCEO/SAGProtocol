/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@/lib': './frontend/lib',
    };
    return config;
  },
};

module.exports = nextConfig;
