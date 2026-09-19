import { AuthGuard } from "@/components/auth-guard";
import { Sidebar } from "@/components/sidebar";
import { Toaster } from "sonner";

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</main>
      </div>
      <Toaster position="bottom-left" richColors closeButton />
    </AuthGuard>
  );
}
