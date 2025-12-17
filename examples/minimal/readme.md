# Minimal Example

The simplest Solarflare app — a single route with server handler and client component.

## Structure

```
src/
├── index.server.tsx   # Server handler
└── index.client.tsx   # Client component
```

## Quick Start

```sh
npm install
npm run dev
```

## Code

**Server Handler** (`src/index.server.tsx`):

```tsx
export default async function server(_request: Request, _params: Record<string, string>) {
  return { hello: "World" };
}
```

**Client Component** (`src/index.client.tsx`):

```tsx
export default function Client(props: { hello: string }) {
  return <h1>Hello {props.hello}</h1>;
}
```
