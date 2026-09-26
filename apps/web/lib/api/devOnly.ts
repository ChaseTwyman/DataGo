import { HttpError } from "./http";
import { isLocalBackend } from "../env";

/** Dev routes exist only with LOCAL_BACKEND=1; otherwise they 404 as if absent. */
export function assertLocalBackend(): void {
  if (!isLocalBackend()) throw new HttpError(404, "NOT_FOUND", "Not found");
}
