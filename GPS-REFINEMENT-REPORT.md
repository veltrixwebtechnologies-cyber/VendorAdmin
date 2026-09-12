# Precise-location acquisition: shared-discussion review and fixes

Date: 12 September 2026. Repositories: locc, DeliveryHub, VendorAdmin. Branch: amrs-map-patch.

## What the discussion establishes

I read the full [shared discussion, Improve Geolocation Accuracy](https://chatgpt.com/s/t_6aa55f192a188191b08a9a6e6993ef22). Its applicable recommendation is to acquire improving browser location readings, check their reported accuracy, display the measurement on the map, and let the customer/vendor confirm the entrance.

OpenStreetMap displays coordinates; changing tile providers cannot make the device measurement more accurate. The browser Geolocation API supplies those measurements. `watchPosition` can deliver subsequent readings, while high accuracy remains a request to the browser/OS. The accuracy value is an estimated horizontal radius at a 95% confidence level, not a promise of zero error. See [MDN watchPosition](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition), [MDN accuracy](https://developer.mozilla.org/en-US/docs/Web/API/GeolocationCoordinates/accuracy), and [Leaflet's map location methods](https://leafletjs.com/reference.html#map-locate).

One part of the shared example was deliberately not adopted: its timeout resolves with the best reading even when that reading is still coarse. That contradicts your requirement to reject inaccurate automatic locations. The implementation continues to reject readings above 25 metres of reported uncertainty. The discussion's broader 25–75 metre automatic/confirmation acceptance bands were not enabled either.

## Root causes remaining in the previous patch

1. **Inconsistent acquisition paths.** The header and discovery map already used a high-accuracy watch, but checkout, vendor pin selection, delivery refresh, and reconnection still had single-reading acquisition paths. A first 800-metre reading could end the attempt before an 18-metre reading arrived.
2. **The first qualifying reading ended acquisition immediately.** The existing helper accepted the first result within 25 metres. It did not allow a short period for a better result, such as an improvement from 18 to 8 metres.
3. **Checkout accuracy was not drawn.** Checkout supplied `accuracyMeters` to the map, but the map did not use it to draw a radius.
4. **The driver halo was decorative.** The live-navigation map described a fixed 60-pixel pulsing marker as a GPS accuracy circle. Its size did not represent the reported uncertainty in metres.
5. **Entrance dragging was missing.** Checkout text advertised tapping or dragging, but the destination marker was not draggable. The vendor editor also only supported tapping/coordinate entry.
6. **Live GPS could disrupt address lookup.** Every checkout GPS update incremented the geocoding revision and reset the address, even when a lookup was skipped by the throttle. Frequent readings could cancel all pending address responses or erase a newly resolved address.
7. **A misleading checkout status remained.** The checkout map's footer used courier-tracking state and could say “No live GPS fix” even after successful checkout GPS acquisition.

These are code findings and reproduced behaviors. They do not establish the actual accuracy or hardware source of the location returned on your particular device.

## Acquisition changes

Each repository now has the same acquisition helper, with identical source verified across the three copies:

- Request a high-accuracy browser watch with `maximumAge: 0` and a 20-second application deadline.
- Validate coordinates, reported accuracy, and capture time. Samples used for a one-time selection must be no more than five seconds old and no more than one second in the future.
- When the first qualifying reading arrives, allow three seconds for refinement. Select the lowest-uncertainty eligible sample; prefer the newer sample when accuracy is equal.
- Preserve the sample's actual coordinates, capture timestamp, and reported accuracy. Do not average coordinates, manufacture a timestamp, or snap the user's measured position to a road.
- Discard samples that become stale during refinement. A better but expired sample cannot override a newer eligible sample.
- At the 20-second deadline, accept only a still-fresh qualifying reading. Otherwise report a failure with the available accuracy diagnostic; never silently return a coarse position.
- Stop immediately on permission denial. Allow transient timeout/unavailable watch errors to recover before the application deadline.
- Clear timers and release the watch on completion, cancellation, and failure.

The 25-metre rule is an acceptance criterion for the browser's estimate. It cannot guarantee that the physical error is zero or actually within that distance.

## Customer app — locc

- Header selection and discovery-map location acquisition use the refined helper.
- Checkout's “Use current location” action now waits for improving readings instead of finishing with its first browser response. Its progress/error messages are visible.
- Selecting another address, moving the pin, confirming the destination, or leaving checkout cancels the pending acquisition through the existing revision mechanism.
- The checkout destination marker is draggable. Starting a drag stops acquisition before a delayed GPS update can move the pin. The selected coordinates update when the drag ends.
- The map draws a Leaflet circle using the actual reported radius in metres. Manual pin selection clears GPS accuracy so an adjusted entrance is not presented as a measured GPS fix.
- The footer shows the selected device accuracy or entrance-confirmation prompt instead of unrelated courier GPS status.
- Live GPS updates skipped by the address-lookup throttle no longer clear the last resolved address or invalidate an in-flight lookup. Explicit address/pin changes still invalidate stale responses.
- Existing confirmation of the exact address and delivery pin remains required. Location selection continues to work independently of whether reverse geocoding succeeds.

## Vendor app — VendorAdmin

- “Use my current location” uses the same refinement helper and reports progress and the selected reading's accuracy.
- Address/pin changes, manual map selection, coordinate entry, and unmount cancel pending acquisition.
- Map readiness no longer cancels an acquisition simply because Leaflet finished initializing.
- Pickup markers are draggable, with the current callback used to save the chosen coordinates.
- A radius measured in metres accompanies the GPS-selected pin. Moving or replacing the pin removes its GPS provenance and switches the message to manual entrance confirmation.
- Existing combined address/pin saving and coordinate validation remain in force.

## Delivery app — DeliveryHub

- Explicit location refresh uses refinement through the existing shared GPS subscription, avoiding another regular device watch.
- Reconnection clears legacy queued readings and requests a new refined fix. It cancels that request if tracking stops or the assignment changes, preventing an old response from being submitted for a different assignment.
- Continuous navigation and tracking continue to consume current validated readings without a three-second delay on every update. Refinement applies to one-time acquisition, not the ongoing moving-driver stream.
- The map now draws the reported GPS uncertainty using a Leaflet circle whose radius is in metres. It replaces the fixed-pixel decorative pulse and is removed when GPS is stale or unavailable.
- Existing real-road routing, pickup/customer phase switching, timestamp checks, and upload validation remain intact.

## Checks against other recommendations

- No remaining `getCurrentPosition` calls or `enableHighAccuracy: false` options were found in the three apps' source trees after these changes.
- No direct IP-geolocation provider calls were found in the inspected source. A browser/OS may still internally derive its measurement from Wi-Fi, cell networks, or other sources; this API does not expose a guaranteed satellite-only mode.
- The existing server policy allows geolocation for the site's own origin: `geolocation=(self)`. Production still requires HTTPS, browser/device permission, and appropriate embedding permissions if opened inside another site.
- No replacement map provider, paid map subscription, new dependency, database migration, or production-data write was needed.
- GPS accuracy continues to be available in the existing location state and supported live-location submissions. No new historical accuracy columns were added to the order, saved-address, or seller tables. The existing address and coordinate persistence paths remain in use.

## Verification completed

| Repository | Passing map tests | TypeScript | Production build |
| --- | ---: | --- | --- |
| locc | 28 | Passed | Passed |
| DeliveryHub | 24 | Passed | Passed |
| VendorAdmin | 13 | Passed | Passed |

Total: 65 passing tests. New cases include refinement from multiple readings, preserving the selected sample's timestamp/coordinates, rejecting coarse best-so-far results at the deadline, late qualifying readings, expiration of an older best sample, cancellation during refinement, permission failures, transient recovery, and shared-watch reuse. Customer tests also execute the actual checkout acquisition callback and verify that frequent live GPS no longer invalidates its address lookup.

Browser verification used the actual components with synthetic public coordinates and isolated backend behavior:

- Checkout selected the 8-metre reading from an 800 → 18 → 8 → 16-metre sequence. Its map centered at the supplied coordinates. Dragging changed the destination and removed GPS accuracy from the manually selected entrance.
- The vendor editor selected the same 8-metre reading, displayed its accuracy, and allowed the pickup entrance to be dragged. The message then correctly switched to manual confirmation.
- Delivery navigation initially waited for GPS, then displayed a real OSRM road route of 125 metres with a one-minute estimate and the supplied 5-metre accuracy. The measured radius was wired through the actual navigation component.

These checks validate application behavior, not the physical accuracy of a real device. No real user location, payment, order, or production delivery was submitted during verification.

## Deployment and physical-device verification

Deploy the matching latest `amrs-map-patch` branches, or merge them into the branch your deployment actually builds. Pushing a patch branch does not by itself prove that the running site uses it. No deployment was performed in this task.

On a phone with device location services and precise permission enabled, open the deployed HTTPS site in a normal top-level browser tab. Request the location near a window or outdoors, observe the acquisition progress and reported accuracy, inspect the entrance pin, and confirm it. Repeat with poor signal and permission denied: the app should report the problem and never auto-select a coarse location. Also check delivery refresh, reconnection, and vendor pickup selection.

If a device consistently reports hundreds of metres of uncertainty, this code will reject the reading. Further software filtering cannot turn it into a genuinely precise fix. The next diagnosis requires the actual device/browser, deployment commit, permission result, and reported accuracy—not a different OpenStreetMap tile provider.
