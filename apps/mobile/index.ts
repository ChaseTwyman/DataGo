/**
 * App entry. Import order is evaluation order, and it matters:
 * 1. `expo` installs its runtime globals (incl. a UTF-8-only TextDecoder) as a side effect.
 * 2. We wrap TextDecoder so h3-js (Emscripten) can create its UTF-16LE decoder at load time.
 * 3. expo-router loads the routes, which import @groundtruth/shared -> h3-js.
 */
import "expo";
import "./src/lib/installTextDecoderUtf16";
import "expo-router/entry";
