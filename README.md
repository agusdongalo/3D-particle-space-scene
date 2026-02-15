3D-particle-space-scene

A web-based JavaScript project that renders a fullscreen “space” particle system in 3D using Three.js and controls it with MediaPipe Hands, WITHOUT showing the webcam feed.

The Current gesture controls
- No hand: ambient drift + slow spin (always moving).
- Open palm: instant spread (particles burst outward).
- Fist (closed hand): compresses into a 3D spiral galaxy at the center.
- Pointing (index finger only): Black Hole mode (strong pull + stronger swirl).

Notes
- The galaxy and forces are centered at the scene origin (always centered).
- Webcam preview is shown in a small overlay for debugging hand detection.