export const metadata = {
  title: "Google Maps Lead Scraper",
  description: "Scrape business leads from Google Maps with email enrichment",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
