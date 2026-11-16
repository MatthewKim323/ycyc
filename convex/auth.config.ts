import type { AuthConfig } from "convex/server";

// On each Convex deployment, set CLERK_JWT_ISSUER_DOMAIN to the matching Clerk
// Frontend API HTTPS origin. Enable Clerk's Convex integration (or a JWT template
// named "convex") with audience "convex". The mobile publishable key must belong
// to that same Clerk instance. Missing config preserves anonymous device mode;
// verified account linking remains unavailable rather than trusting client IDs.
const issuer = process.env.CLERK_JWT_ISSUER_DOMAIN;
export default {
  providers: issuer ? [{ domain: issuer, applicationID: "convex" }] : [],
} satisfies AuthConfig;
