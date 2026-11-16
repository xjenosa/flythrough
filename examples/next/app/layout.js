import './page.css';

export const metadata = { title: 'flythrough with Next' };

export default function Layout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
