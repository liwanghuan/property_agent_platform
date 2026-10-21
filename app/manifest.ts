import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Team Workbench",
    short_name: "Workbench",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f7f9",
    theme_color: "#14213d",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
