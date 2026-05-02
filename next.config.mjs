/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Prototype config — no production wiring.
  experimental: {
    typedRoutes: false,
  },
};

export default nextConfig;
