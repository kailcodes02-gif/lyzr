import Link from "next/link";
import { Mail, Share2, HelpCircle, Upload } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const ACTIONS = [
  {
    href: "/email",
    title: "Email generation",
    description: "Draft a TOFU/MOFU/BOFU email using your inbox, HubSpot activity, and the knowledge base.",
    icon: Mail,
  },
  {
    href: "/linkedin",
    title: "LinkedIn posts",
    description: "Generate on-voice LinkedIn posts from your sample posts, a topic, or your sources.",
    icon: Share2,
  },
  {
    href: "/faq",
    title: "FAQ",
    description: "Ask questions against the knowledge base, or generate a document/one-pager.",
    icon: HelpCircle,
  },
  {
    href: "/knowledge",
    title: "Upload knowledge",
    description: "Paste text or upload a PDF/image — converted to markdown and added to the shared knowledge base.",
    icon: Upload,
  },
];

export default function HomePage() {
  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">What do you want to do?</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {ACTIONS.map((action) => (
          <Link key={action.title} href={action.href} className="block">
            <Card className="h-full transition-colors hover:ring-2 hover:ring-ring/40 cursor-pointer">
              <CardHeader>
                <action.icon className="size-5 mb-2 text-brand-terracotta" strokeWidth={1.75} />
                <CardTitle className="text-base font-medium">{action.title}</CardTitle>
                <CardDescription>{action.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
