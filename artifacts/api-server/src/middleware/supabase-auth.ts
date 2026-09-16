import { createClient } from "@supabase/supabase-js";
import type { NextFunction, Request, Response } from "express";

export type AuthenticatedRequest = Request & {
  user: {
    id: string;
    email?: string;
  };
};

export async function requireSupabaseUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authorization = req.header("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;
  const supabaseUrl = process.env.SUPABASE_URL ?? req.header("x-supabase-url");
  const supabaseKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    req.header("apikey");

  if (!token || !supabaseUrl || !supabaseKey) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    res.status(401).json({ error: "Your session has expired. Please sign in again." });
    return;
  }

  (req as AuthenticatedRequest).user = {
    id: data.user.id,
    email: data.user.email,
  };
  next();
}