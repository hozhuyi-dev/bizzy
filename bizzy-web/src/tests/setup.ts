import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.mock("aws-amplify/auth", () => ({
  fetchAuthSession: vi.fn().mockResolvedValue({ tokens: undefined }),
  signInWithRedirect: vi.fn(),
  signOut: vi.fn(),
}));
