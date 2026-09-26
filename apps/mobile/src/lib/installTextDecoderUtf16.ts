/** Side-effect module: see textDecoderUtf16.ts and index.ts for why and when this runs. */
import { patchTextDecoder } from "./textDecoderUtf16";

patchTextDecoder(globalThis as { TextDecoder?: unknown });
