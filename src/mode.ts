// Pages builds are deliberately independent of the backend.
export const SERVER_ENABLED =
  import.meta.env.MODE === "server" ||
  (import.meta.env.VITE_APP_MODE !== "static" &&
    (import.meta.env.VITE_APP_MODE === "server" ||
      Boolean(import.meta.env.VITE_API_URL)));
