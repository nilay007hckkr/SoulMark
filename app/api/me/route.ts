import { currentUser, fail, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = currentUser(req);
  if (!user) return fail(401, "Not signed in");
  return json({ wallet: user.wallet, handle: user.handle, email: user.email });
}
