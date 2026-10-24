import { useStayCurrent } from "../../sync.hook";

/** Keeps what the app shows true to what changed elsewhere (see useStayCurrent); renders nothing. */
export function StayCurrent() {
  useStayCurrent();
  return null;
}
