// The web app manifest: added to an iPad's Home Screen (or installed from
// Edge or Chrome), Plotwire opens full screen like an app. On an iPad that
// also keeps what it stores for working without signal, which Safari clears
// for websites after about a week of not being used (components/OfflinePanel
// HomeScreenTip says so).
export default function manifest() {
  return {
    name: "Plotwire",
    short_name: "Plotwire",
    description: "Electrical layouts, quotes and drawings for electricians",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F4F6F9",
    theme_color: "#2C97A8",
    // public/icons: drawn by a small script from the dashboard's brandmark.
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
