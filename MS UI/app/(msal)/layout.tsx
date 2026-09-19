import { Providers } from "@/components/providers";

// Everything except the redirect bridge lives under this layout.
export default function MsalLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
