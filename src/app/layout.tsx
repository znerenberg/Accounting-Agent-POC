export const metadata = {
  title: "Bill Coding Assistant",
  description: "AI-powered GL coding suggestions for bill pay",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#f9fafb" }}>{children}</body>
    </html>
  );
}
