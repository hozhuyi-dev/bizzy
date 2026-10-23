/**
 * Only development and staging builds offer a reset; the production API
 * doesn't serve it either.
 */
export const CAN_RESET = import.meta.env.MODE !== "production";
