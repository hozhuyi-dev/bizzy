import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.mock("aws-amplify/auth", () => ({
  fetchAuthSession: vi.fn().mockResolvedValue({ tokens: undefined }),
  signInWithRedirect: vi.fn(),
  signOut: vi.fn(),
}));

// jsdom has no matchMedia; the theme reads the device's light/dark setting.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }),
});

// jsdom lays nothing out, so has no scrollIntoView; a form scrolls to its first error.
Element.prototype.scrollIntoView = vi.fn();
