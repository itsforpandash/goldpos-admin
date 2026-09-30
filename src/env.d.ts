type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {
    SESSION?: SessionAdmin | null;
  }
}

interface SessionAdmin {
  id: number;
  username: string;
  full_name: string;
  role: string;
  is_active: boolean;
}
