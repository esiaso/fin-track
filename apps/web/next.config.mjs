/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@fintrack/shared'],
  poweredByHeader: false,
  images: { unoptimized: true },
};
export default nextConfig;
