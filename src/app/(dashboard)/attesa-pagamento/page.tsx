import { redirect } from "next/navigation";

/** Sezione rimossa: tracciamento in Provvigioni. */
export default function AttesaPagamentoRedirect() {
  redirect("/provvigioni");
}
