"use server";

import { destroySession } from "@/lib/auth";
import { redirect } from "next/navigation";

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
