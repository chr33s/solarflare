# Shopify App Example

A Solarflare app embedded in Shopify Admin, using the Shopify CLI for local dev and Cloudflare Workers for runtime.

## Structure

```
src/
├── _layout.tsx        # Loads Shopify App Bridge + Polaris
├── index.server.tsx   # Sets CSP + provides SHOPIFY_API_KEY
├── index.client.tsx   # Embedded UI + example GraphQL request
├── _error.tsx         # Error page
└── index.ts           # Worker entry (delegates to Solarflare worker)
```

## Quick Start

```sh
npm install
npm run dev
```

## Deploy

```sh
npm run deploy
```
