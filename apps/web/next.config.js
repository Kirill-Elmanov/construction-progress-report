/** @type {import('next').NextConfig} */
const nextConfig = {
  // Транспиляция наших workspace-пакетов (иначе Next не поймёт @rost/*)
  transpilePackages: ['@rost/shared', '@rost/ui-config'],
};

module.exports = nextConfig;