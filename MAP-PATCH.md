# Confirmed pickup locations

Seller registration now requires a pickup entrance pin using the map, precise device location, or explicit coordinates. Changing address fields clears the pin until it is reconfirmed. Address and pin are saved together. A separate pickup address uses its own pin rather than the business address location.

Pickup coordinates are written to the existing `sellers.lat/lng` columns and matching wizard fields, which DeliveryHub reads consistently. No schema migration is required. Existing sellers without accurate pins must update and save their pickup address before reliable routing is possible.

Validation: `npm run test:maps`, `npx tsc --noEmit`, and `npm run build`. The browser editor was checked with synthetic coordinates and map clicks. Authenticated saves to Supabase still need a configured test account; no remote data was changed during development.

Release together with the `amrs-map-patch` branches of DeliveryHub and locc. Verify a seller with a separate pickup address, save the pin, and confirm the delivery app routes to that entrance.
