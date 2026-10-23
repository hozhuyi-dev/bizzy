import { useMutation } from "@tanstack/react-query";
import { ConflictsService } from "./conflicts.service";

// Settling an edit can change sessions, packages and documents: read again as the API says.
export const ConflictsMutation = {
  useRevert: () => useMutation({ mutationFn: ConflictsService.revert }),
  useApply: () => useMutation({ mutationFn: ConflictsService.apply }),
};
