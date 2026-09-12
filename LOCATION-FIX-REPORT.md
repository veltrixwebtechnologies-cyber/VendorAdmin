# Location integration and fixes — 12 September 2026

## Branch integration

Work was completed on `amrs-map-patch` in locc, DeliveryHub, and VendorAdmin. The remote patch branches had been moved to the same commits as main. The original patch commits were still available locally, so the integration uses merge commits rather than resetting, rebasing, or force-pushing the branches.

| Repository | Original patch retained | Latest main integrated |
| --- | --- | --- |
| locc | `76c67ce` | `dafb0f3` |
| DeliveryHub | `ccbb6a3` | `49c0aed` |
| VendorAdmin | `7ceca36` | `21d9bae` |

The merge retains newer main work such as checkout payment flows, shopper layouts and filters, delivery status/verification screens, seller administration, and vendor live guidance. Where main conflicted with the map patch, the location-validation, route-cancellation, and confirmed-pin behavior was restored and adapted to the newer interfaces. The original patch tests remain present.

## Customer checkout — locc

1. **No invented delivery location.** Selecting Current location no longer assigns the shop coordinates or a hardcoded Coimbatore point. A saved address without a valid pin leaves the destination unset. Missing pins do not turn into delivery coordinates during payment or order creation.
2. **Precise, recent GPS is required.** Coordinate range, numeric values, timestamp, and reported accuracy are validated. A fix must be no older than 30 seconds, no more than one second in the future, and have accuracy within 100 metres. Live checkout tracking requests high accuracy with no cached-position allowance. An unsuitable fix produces an actionable message; manual map selection remains available.
3. **Address and pin must be confirmed together.** The confirmation is bound to the exact address text and latitude/longitude. Changing the address, choosing another address, or moving the pin requires confirmation again. Saving a new address also requires confirmation of its matching pin.
4. **All checkout order paths validate the destination.** COD, Razorpay initiation, verification, and the existing simulated-payment path retain their main implementation with the location guard applied. The orders store and Razorpay server input validators also reject missing or invalid destination coordinates.
5. **Late location callbacks cannot overwrite a user choice.** Stopping tracking, choosing an address, editing text, confirming a pin, or moving the marker invalidates pending acquisition/geocoding callbacks. A delayed result is discarded rather than changing the confirmed address or destination.
6. **The map follows the selected entrance.** An asynchronously acquired pin now updates the map camera as well as the marker. The map-click callback uses the current checkout handler rather than an old closure captured during Leaflet initialization.
7. **No guessed city label.** Reverse-geocoding failures retain a coordinate-based label instead of appending Coimbatore or Tamil Nadu. The header/global GPS-location path also validates accuracy and freshness and cannot overwrite a newer explicit selection after an asynchronous lookup.

## Delivery executive — DeliveryHub

1. **Navigation starts from measured GPS.** The original patch behavior is retained: no destination-offset driver position, made-up heading, invented accuracy, or newly timestamped old partner position. Missing GPS is shown as waiting, and old GPS is shown as stale.
2. **A shared continuous GPS watch.** Navigation, delivery tracking, and the partner view subscribe to one high-accuracy browser watch with no cached-position allowance. The underlying watch is released when its last subscriber leaves. Existing explicit refresh requests remain separate one-shot acquisitions.
3. **Bad fixes are rejected before use or upload.** The 100-metre/30-second navigation checks are retained. Upload paths additionally require a fix captured within five seconds. Unknown accuracy is not silently accepted as precise. Excessive accuracy values are no longer stripped to null to evade rejection.
4. **Capture timestamps and failures are preserved.** Partner submissions send the device capture time. Location-service RPC failures propagate instead of falling back to unvalidated direct table writes. The legacy offline queue is discarded rather than replayed as fresh current positions. The assignment RPC still records server receipt time, but this client supplies only recent fixes and does not replay queued history through it.
5. **Real locations outside Coimbatore are preserved.** Removed normalization that replaced valid latitude ranges, missing vendor coordinates, and missing customer coordinates with unrelated Coimbatore-area points. Customer and pickup coordinates are parsed independently; neither is fabricated from the other.
6. **Correct pickup semantics.** A separate pickup address uses its pickup pin. Canonical and supported legacy coordinate representations are normalized consistently. A location flagged as needing confirmation is not used for pickup navigation.
7. **Actual road routing retained.** The patch's OSRM road geometry, longitude/latitude ordering, bounded road snapping, road-segment progress, metre-based maneuver distances, off-route recalculation, request cancellation, and phase-change handling remain in place. Failure is an explicit error, not a straight line masquerading as a road route.
8. **Pickup-to-customer transition retained.** Pickup completion changes the destination and cancels obsolete route requests. Late shop-route responses cannot replace the customer route. Newer main status/verification UI and external navigation controls remain available.
9. **External OSM links use known coordinates.** Without an origin, the link shows the destination marker rather than passing the unsupported literal “Current Location” as route coordinates. With fresh GPS, it supplies both origin and destination.
10. **Vendor live guidance is checked before routing.** The active order's vendor location must be active, valid, recent, and accurate within 100 metres. It expires after 30 seconds without an update. Stale initial reads and updates from a previous order cannot overwrite the current order's guidance. When guidance expires, navigation returns to the confirmed pickup pin.

## Customer delivery tracking — locc

1. Removed the unfiltered subscription to delivery-partner updates. Tracking now uses the selected assignment, or the selected order when no assignment ID is available.
2. Retained scoped realtime updates and polling recovery. Polling uses the actual location timestamp; rereading a row does not make it fresh. Older responses cannot overwrite newer realtime coordinates.
3. Missing, invalid, or expired courier coordinates are removed from live display. Route calculation waits for a usable courier origin rather than using the shop as the driver's current location.
4. Restored the patch's request coordinator, cancellation on order/destination/phase changes, road-only route display, explicit failure message, and route retry throttling.
5. Restored map readiness handling and removal of obsolete markers. Tile attribution is visible.

## Vendor pickup and live sharing — VendorAdmin

1. Preserved the pickup-pin editor and atomic address/pin save from the original patch.
2. Restored invalidation of the pickup pin after address changes, along with address-schema validation before Save & Continue.
3. GPS-based pin selection rejects stale, invalid, or approximate fixes. Pending GPS cannot overwrite a subsequently selected map pin or an invalidated address pin.
4. Explicitly clearing a scalar pin also clears the matching legacy coordinate object. An old `shopCoordinates` or `pickupCoordinates` value cannot silently restore the cleared pin.
5. Separate pickup coordinates do not overwrite the independent business-location object. Submission of a separate pickup address cannot fall back to the business location.
6. Live location sharing rejects coarse or stale readings before sending them to the delivery app. The recipient's independent freshness/accuracy checks provide an additional check before rerouting.

## Verification

All three repositories pass TypeScript checking and production builds. The 24 map regression tests pass:

- DeliveryHub: 14 tests, including the actual navigation hook lifecycle, stable GPS watching, coordinate validation, real locations outside Coimbatore, vendor guidance expiry, route cancellation, failed routing, progress calculations, upload validation, and RPC failure behavior.
- locc: 6 tests, including execution of the actual checkout callbacks with isolated state/network dependencies, missing-location selection, coarse GPS rejection, stale callback cancellation, exact address/pin confirmation, tracking freshness, route failures, and segment distance.
- VendorAdmin: 4 tests, covering atomic coordinate persistence, separate pickup behavior, clearing scalar coordinates, and clearing legacy coordinate objects.

Browser checks used synthetic public coordinates with backend writes mocked. The real delivery navigation component waited for GPS, obtained OSRM road geometry, and changed from a 125-metre pickup route to a 2.1-kilometre customer route after pickup. The real checkout map centered on a test point outside Coimbatore and updated the selected coordinates after a map click. These are component-level browser checks, not a completed live authenticated delivery.

## Deployment and remaining validation

- No application was deployed and no production database rows were changed. These fixes add no new schema migration; migrations arriving from main remain part of the merged history.
- Deploy the three matching patch branches together after normal review. Existing backend RPCs and the schema expected by current main must be available.
- Existing orders or sellers containing incorrect but numerically valid coordinates are not automatically repaired. Confirm their entrance pins through the normal user/vendor flow.
- Test a complete authenticated delivery on an actual phone: deny/grant precise location, confirm the checkout entrance, accept the assignment, navigate to pickup, complete pickup, navigate to the customer, and verify OTP/completion. Include going offline, reconnecting, leaving the route, and moving away after GPS becomes stale.
- A browser cannot manufacture precise hardware location. If the device only supplies an approximate position, checkout/vendor flows permit deliberate map selection; driver navigation waits for usable GPS.
- Routing still uses the configured OSRM car profile. Road data and network availability affect results; this is not offline, traffic-aware, or motorcycle-specific navigation.
- Backend capture/accuracy enforcement across older deployed clients was not exercised against a live database. The client rejects bad readings, but authenticated end-to-end verification is still required before treating the system as production-validated.
