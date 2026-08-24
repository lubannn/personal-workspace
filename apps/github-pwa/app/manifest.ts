import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Personal Workspace",
    short_name: "Workspace",
    description: "GitHub-backed personal workspace",
    start_url: ".",
    display: "standalone",
    background_color: "#f2f0ea",
    theme_color: "#f2f0ea",
    icons: [{ src: "workspace-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
