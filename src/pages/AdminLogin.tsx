import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AuthError, AuthShell, PasswordField } from "./Login";

// Admin accounts sign in as <username>@tablelk.com. This page only signs in:
// it never creates accounts. Admin rights come from a row in public.user_roles,
// which only an existing admin (Users tab) or the database owner (SQL editor) can add.
const usernameToEmail = (username: string) => `${username.trim().toLowerCase()}@tablelk.com`;

const AdminLogin: React.FC = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const { state } = useAuth();
  const { isAdmin, loading } = useIsAdmin();

  useEffect(() => {
    if (state.isAuthenticated && !loading && isAdmin) navigate("/admin");
  }, [state.isAuthenticated, isAdmin, loading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const email = usernameToEmail(username);
    try {
      const { data: signedIn, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError || !signedIn.user) throw new Error("Incorrect username or password.");

      // A valid sign-in is not enough: the account must hold the admin role.
      const { data: role } = await (supabase as any)
        .from("user_roles")
        .select("role")
        .eq("user_id", signedIn.user.id)
        .eq("role", "admin")
        .maybeSingle();
      if (!role) {
        await supabase.auth.signOut();
        throw new Error("This account does not have admin access.");
      }
      toast.success("Welcome, admin");
      navigate("/admin");
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title="Admin sign in" help="Restricted access. Authorized personnel only.">
      <AuthError message={error} />
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="username">Username</Label>
          <Input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            disabled={submitting}
            aria-invalid={!!error}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <PasswordField
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            disabled={submitting}
            aria-invalid={!!error}
            visible={showPassword}
            onToggle={() => setShowPassword(!showPassword)}
          />
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="animate-spin" /> Signing in
            </>
          ) : (
            "Sign in"
          )}
        </Button>
      </form>
    </AuthShell>
  );
};

export default AdminLogin;
