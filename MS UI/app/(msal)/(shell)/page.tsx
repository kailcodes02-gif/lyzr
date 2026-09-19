"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Spinner } from "@/components/auth-guard";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/outlook/");
  }, [router]);
  return <Spinner />;
}
